import { computed, readonly, ref, shallowRef } from 'vue';
import type { RenderFailureDiagnostic, RenderFailureOrigin } from './utility/render-failure.ts';

/** エラー中はエンジンを持たない。再試行は設定変更か明示操作だけで行う。 */
export class PreviewRenderEngine {
	private staticError = ref<string | null>(null);
	private runtimeError = shallowRef<RenderFailureDiagnostic | null>(null);
	private suspended = ref(false);
	private enabled = ref(false);
	private generation = 0;
	private restarting: Promise<void> | null = null;
	private retryScheduled = false;
	public readonly runtimeDiagnostic = readonly(this.runtimeError);
	public readonly errorMessage = computed(() => this.staticError.value ?? this.runtimeError.value?.message ?? null);
	public readonly canRender = computed(() => this.enabled.value && !this.suspended.value && this.errorMessage.value == null);

	constructor(private operations: { dispose: (reason?: Error) => void; create: (isCurrent: () => boolean) => Promise<void> }) {}

	public setValidationError(message: string | null) {
		const previous = this.staticError.value;
		this.staticError.value = message;
		if (message && previous == null) this.stop();
		if (message == null && previous != null) this.requestRetry();
	}

	public fail(error: unknown, origin?: RenderFailureOrigin) {
		const reason = error instanceof Error ? error : new Error(String(error));
		// 実行中の状態ストアとは別に保持し、disposeで通知元の情報まで消さない。
		this.runtimeError.value = { message: reason.message, origin };
		this.stop(reason);
	}

	private stop(reason?: Error) {
		this.generation++;
		this.retryScheduled = false;
		this.operations.dispose(reason);
	}

	public suspend() { this.suspended.value = true; this.stop(); }
	public resume() { this.suspended.value = false; return this.retry(); }
	public enable() { this.enabled.value = true; return this.retry(); }

	/** 同じ編集の複数通知をまとめ、状態の変更が確定してから最新設定で再試行する。 */
	public requestRetry(): void {
		if (this.retryScheduled) return;
		this.retryScheduled = true;
		const generation = this.generation;
		queueMicrotask(() => {
			// 予約後の失敗・停止は、この予約で勝手に解除しない。
			if (!this.retryScheduled || generation !== this.generation) return;
			this.retryScheduled = false;
			void this.retry();
		});
	}

	public retry(): Promise<void> {
		this.retryScheduled = false;
		if (!this.enabled.value || this.suspended.value || this.staticError.value) return Promise.resolve();
		this.runtimeError.value = null;
		// 初期化中の複数変更は、同じ生成を待つ。エラーで無効化した生成は再利用しない。
		if (this.restarting) return this.restarting.then(() => this.canRender.value ? this.createIfNeeded() : undefined);
		return this.createIfNeeded();
	}

	private createIfNeeded(): Promise<void> {
		if (!this.canRender.value) return Promise.resolve();
		if (this.restarting) return this.restarting;
		const generation = this.generation;
		const pending = this.operations.create(() => generation === this.generation && this.canRender.value).catch(error => {
			// エンジン破棄が原因の初期化失敗で、次の世代の診断を上書きしない。
			if (generation === this.generation) this.fail(error);
		}).finally(() => { if (this.restarting === pending) this.restarting = null; });
		this.restarting = pending;
		return pending;
	}
}
