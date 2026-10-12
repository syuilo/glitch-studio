import { computed, ref } from 'vue';

/** エラー中はエンジンを持たない。再試行は設定変更か明示操作だけで行う。 */
export class PreviewRenderEngine {
	private staticError = ref<string | null>(null);
	private runtimeError = ref<string | null>(null);
	private suspended = ref(false);
	private enabled = ref(false);
	private generation = 0;
	private restarting: Promise<void> | null = null;
	public readonly errorMessage = computed(() => this.staticError.value ?? this.runtimeError.value);
	public readonly canRender = computed(() => this.enabled.value && !this.suspended.value && this.errorMessage.value == null);

	constructor(private operations: { dispose: () => void; create: (isCurrent: () => boolean) => Promise<void> }) {}

	public setValidationError(message: string | null) {
		const previous = this.staticError.value;
		this.staticError.value = message;
		if (message && previous == null) this.stop();
	}

	public fail(error: unknown) {
		this.runtimeError.value = error instanceof Error ? error.message : String(error);
		this.stop();
	}

	private stop() {
		this.generation++;
		this.operations.dispose();
	}

	public suspend() { this.suspended.value = true; this.stop(); }
	public resume() { this.suspended.value = false; return this.retry(); }
	public enable() { this.enabled.value = true; return this.retry(); }

	public retry(): Promise<void> {
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
