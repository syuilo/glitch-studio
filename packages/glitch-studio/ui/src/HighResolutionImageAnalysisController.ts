import { ref, shallowRef } from 'vue';
import { copyPreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import { i18n } from './i18n.ts';
import type { PreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';

export interface HighResolutionImageAnalysisSource {
	setHighResolutionImageAnalysis(enabled: boolean, settings: PreviewImageAnalysisSettings): Promise<boolean>;
}

/** 保持元・設定の間引き・反映済みの目盛りを所有し、再生や作品の状態は変更しない。 */
export class HighResolutionImageAnalysisController<Source extends HighResolutionImageAnalysisSource> {
	public readonly active = ref(false);
	public readonly busy = ref(false);
	public readonly source = shallowRef<Source | null>(null);
	public readonly displayedSettings = shallowRef<PreviewImageAnalysisSettings | null>(null);
	public readonly errorMessage = ref<string | null>(null);
	private generation = 0;
	private running = false;
	private pending: PreviewImageAnalysisSettings | null = null;
	private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
	private flushRequested = false;

	constructor(private readonly operations: {
		setLivePaused(paused: boolean): Promise<void>;
		refreshLive(): void;
		onError(error: unknown): void;
	}) {}

	public async enable(source: Source, settings: PreviewImageAnalysisSettings) {
		if (this.active.value) return;
		this.reset();
		const generation = this.generation;
		this.source.value = source;
		this.active.value = true;
		this.busy.value = true;
		this.running = true;
		const capturedSettings = copyPreviewImageAnalysisSettings(settings);
		this.displayedSettings.value = capturedSettings;
		try {
			// 保持要求を先に送る。通常解析の休止RPCを待つ間に元フレームを入れ替えない。
			const [captured] = await Promise.all([source.setHighResolutionImageAnalysis(true, capturedSettings), this.operations.setLivePaused(true)]);
			if (generation !== this.generation) return;
			if (!captured) {
				const disabledGeneration = this.generation + 1;
				await this.disable();
				if (disabledGeneration === this.generation) this.errorMessage.value = i18n.ts._ImageAnalysis.NoPreviewFrame;
				return;
			}
			this.displayedSettings.value = capturedSettings;
		} catch (error) {
			if (generation === this.generation) { this.reset(); this.operations.onError(error); }
		} finally { this.finishRequest(generation); }
	}

	public update(settings: PreviewImageAnalysisSettings) {
		if (!this.active.value) return;
		this.pending = copyPreviewImageAnalysisSettings(settings);
		this.busy.value = true;
		this.schedule();
	}

	private schedule() {
		if (this.running || this.pending == null || this.timer != null) return;
		// 連続ドラッグでは最新値だけを送り、送信済みのGPU処理へ要求を積み重ねない。
		this.timer = globalThis.setTimeout(() => { this.timer = null; void this.runPending(); }, 100);
	}

	public flush() {
		if (this.timer != null) globalThis.clearTimeout(this.timer);
		this.timer = null;
		if (this.running) { this.flushRequested = true; return; }
		void this.runPending();
	}

	private async runPending() {
		const source = this.source.value;
		const settings = this.pending;
		if (!this.active.value || this.running || source == null || settings == null) return;
		this.pending = null;
		this.running = true;
		const generation = this.generation;
		try {
			const applied = await source.setHighResolutionImageAnalysis(true, settings);
			// 解析完了までグラフの軸は旧設定を使い、まだ反映していない範囲の目盛りを重ねない。
			if (generation === this.generation && applied) this.displayedSettings.value = settings;
		} catch (error) {
			if (generation === this.generation) { this.reset(); this.operations.onError(error); }
		} finally { this.finishRequest(generation); }
	}

	private finishRequest(generation: number) {
		if (generation !== this.generation) return;
		this.running = false;
		this.busy.value = this.pending != null;
		if (this.flushRequested) { this.flushRequested = false; this.flush(); } else this.schedule();
	}

	public async disable() {
		const source = this.source.value;
		const settings = this.displayedSettings.value;
		this.reset();
		const generation = this.generation;
		await Promise.all([source == null || settings == null ? Promise.resolve() : source.setHighResolutionImageAnalysis(false, settings), this.operations.setLivePaused(false)]);
		if (generation === this.generation) this.operations.refreshLive();
	}

	/** Workerの再生成では保持テクスチャも失われる。新しいフレームを黙って取り直さずモードを解除する。 */
	public reset() {
		this.generation++;
		if (this.timer != null) globalThis.clearTimeout(this.timer);
		this.timer = null;
		this.pending = null;
		this.running = false;
		this.flushRequested = false;
		this.active.value = false;
		this.busy.value = false;
		this.source.value = null;
		this.displayedSettings.value = null;
		this.errorMessage.value = null;
	}
}
