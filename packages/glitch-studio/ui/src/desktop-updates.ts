import { ref, shallowRef, watch } from 'vue';
import type { DesktopUpdateState } from '@gs/glitch-studio_shared/desktop-update.ts';

type DesktopUpdateApi = Pick<NonNullable<Window['desktop']>, 'getUpdateState' | 'onUpdateStateChanged' | 'checkForUpdates' | 'prepareUpdate' | 'startUpdate' | 'abortUpdatePreparation'>;
type UpdatePreparation = {
	reserve(): () => void;
	pause(): Promise<() => Promise<void>>;
};

/** mainの状態を表示へ反映し、終了前にUIの非同期処理を完了させる。プロジェクト状態には含めない。 */
export class DesktopUpdates {
	readonly state = shallowRef<DesktopUpdateState>({ revision: -1, phase: 'disabled', version: null, progress: null, error: null });
	readonly running = ref(false);
	readonly localError = ref<string | null>(null);
	private unsubscribe: (() => void) | null = null;

	constructor(private api: DesktopUpdateApi, private preparation: UpdatePreparation) {}

	private accept(state: DesktopUpdateState): void {
		// 購読開始後のイベントより、先に要求したsnapshotの返答が遅れて到着する場合がある。
		if (state.revision > this.state.value.revision) this.state.value = state;
	}

	async connect(): Promise<void> {
		this.unsubscribe = this.api.onUpdateStateChanged(state => this.accept(state));
		this.accept(await this.api.getUpdateState());
	}

	dispose(): void { this.unsubscribe?.(); this.unsubscribe = null; }

	async check(): Promise<DesktopUpdateState> {
		this.accept(await this.api.checkForUpdates());
		return this.state.value;
	}

	async start(version: string): Promise<void> {
		if (this.running.value) return;
		this.running.value = true;
		this.localError.value = null;
		let releaseActivity: (() => void) | null = null;
		let resumeApplication: (() => Promise<void>) | null = null;
		let stopWaiting = () => {};
		try {
			releaseActivity = this.preparation.reserve();
			this.accept(await this.api.prepareUpdate(version));
			if (this.state.value.phase !== 'preparing') return;
			resumeApplication = await this.preparation.pause();
			const failed = new Promise<void>(resolve => {
				stopWaiting = watch(this.state, state => { if (state.phase === 'error') resolve(); }, { flush: 'sync' });
			});
			this.accept(await this.api.startUpdate());
			// 正常完了ではプロセスが終了する。失敗時だけ受付・保存・プレビューを復帰させる。
			await failed;
		} catch (error) {
			this.localError.value = error instanceof Error ? error.message : String(error);
			try { this.accept(await this.api.abortUpdatePreparation()); } catch (cause) { console.error(cause); }
		} finally {
			stopWaiting();
			try { await resumeApplication?.(); } catch (error) { this.localError.value = error instanceof Error ? error.message : String(error); }
			releaseActivity?.();
			this.running.value = false;
		}
	}
}
