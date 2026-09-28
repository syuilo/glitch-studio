import { ref, shallowReactive } from 'vue';

type ManagerMethods<T> = {
	[K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K];
};

// 対象のRendererManagerがWorker越しに動いているのか直接動いているのか隠蔽するクラス(現在はworkerのみ)
export abstract class RendererManagerControllerBase<T> {
	private worker: Worker | null = null;
	private reloadPromise: Promise<void> | null = null;
	private rejectInitialization: ((reason: Error) => void) | null = null;
	private pendingCalls: { message: unknown; options?: StructuredSerializeOptions; onError?: (error: unknown) => void }[] = [];

	private getInitialOptions: ((isReload: boolean) => Promise<{ options: StructuredSerializeOptions; transfer: Transferable[] }>);
	private createWorker: () => Promise<Worker>;
	private managerEventHandlers: Record<string, (ctx: unknown) => void>;
	private onCreated: (() => void);
	private onDisposed: (() => void);

	public readonly isReady = ref(false);
	public errorMessage = ref<string | null>(null);

	constructor(options: {
		getInitialOptions: RendererManagerControllerBase<T>['getInitialOptions'];
		createWorker: RendererManagerControllerBase<T>['createWorker'];
		eventHandlers: RendererManagerControllerBase<T>['managerEventHandlers'];
		onCreated: RendererManagerControllerBase<T>['onCreated'];
		onDisposed: RendererManagerControllerBase<T>['onDisposed'];
	}) {
		this.getInitialOptions = options.getInitialOptions;
		this.createWorker = options.createWorker;
		this.managerEventHandlers = options.eventHandlers;
		this.onCreated = options.onCreated;
		this.onDisposed = options.onDisposed;
	}

	protected call<FN extends keyof ManagerMethods<T>>(fn: FN, args: Parameters<ManagerMethods<T>[FN]>, options?: StructuredSerializeOptions | Transferable[]): void {
		//console.log('Calling renderer method:', fn, 'with args:', args);
		const message = { type: 'call', fn, args };
		const serializeOptions = Array.isArray(options) ? { transfer: options } : options;
		if (!this.isReady.value) {
			if (this.worker != null && this.rejectInitialization != null) {
				this.pendingCalls.push({ message, options: serializeOptions });
				return;
			}
			throw new Error('Renderer is not initialized');
		}
		if (this.worker != null) {
			this.worker.postMessage(message, serializeOptions);
		//} else if (this.renderer != null) {
		//	this.renderer[fn](...args);
		} else {
			throw new Error('Renderer is not initialized');
		}
	}

	private returnHooks = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
	private callCounter = 0;

	// 初期化チェックなどの同期的なthrowもPromiseのrejectに統一し、呼び出し側で.catch()でも受け取れるようasyncにする。
	protected async callAndWaitReturn<FN extends keyof ManagerMethods<T>>(fn: FN, args: Parameters<ManagerMethods<T>[FN]>, options?: StructuredSerializeOptions | Transferable[]): Promise<Awaited<ReturnType<RendererMethods[FN]>>> {
		const serializeOptions = Array.isArray(options) ? { transfer: options } : options;
		if (!this.isReady.value && this.rejectInitialization == null) {
			throw new Error('Renderer is not initialized');
		}
		if (this.worker != null) {
			return new Promise<Awaited<ReturnType<ManagerMethods<T>[FN]>>>((resolve, reject) => {
				const id = this.callCounter++;
				this.returnHooks.set(id, {
					resolve: value => resolve(value as Awaited<ReturnType<ManagerMethods<T>[FN]>>),
					reject,
				});
				const onError = (error: unknown) => {
					this.returnHooks.delete(id);
					reject(error);
				};
				try {
					const message = { type: 'call', fn, args, needReturnValue: true, id };
					// initメッセージ送信後の編集も、初期化完了時に送って応答まで待つ。
					if (!this.isReady.value) this.pendingCalls.push({ message, onError, options: serializeOptions });
					else this.worker!.postMessage(message, serializeOptions);
				} catch (error) {
					onError(error);
				}
			});
		} else {
			throw new Error('Renderer is not initialized');
		}
	}

	private rejectPendingReturns(error: Error) {
		// 終了したWorkerからは応答が来ないため、呼び出し側の待機も必ず解除する。
		for (const hook of this.returnHooks.values()) hook.reject(error);
		this.returnHooks.clear();
	}

	protected async launchManager(isReload: boolean) {
		const { promise: ready, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers<void>();
		this.rejectInitialization = rejectReady;

		this.worker = await this.createWorker();
		const worker = this.worker;
		worker.onerror = (event) => {
			if (this.worker !== worker) return;
			this.isReady.value = false;
			const error = new Error(event.message || 'Renderer worker failed');
			this.errorMessage.value = error.message;
			this.rejectPendingReturns(error);
			this.rejectInitialization?.(error);
			this.rejectInitialization = null;
			this.pendingCalls = [];
		};
		const { options: initOptions, transfer: initTransfer } = await this.getInitialOptions(isReload);
		worker.postMessage({
			type: 'init',
			...initOptions,
		}, initTransfer);

		worker.onmessage = (event) => {
			switch (event.data?.type) {
				case 'initError': {
					this.isReady.value = false;
					this.errorMessage.value = event.data.message;
					const error = new Error(event.data.message);
					this.rejectPendingReturns(error);
					this.rejectInitialization?.(error);
					this.rejectInitialization = null;
					this.pendingCalls = [];
					break;
				}
				case 'inited': {
					this.isReady.value = true;
					this.errorMessage.value = null;
					this.rejectInitialization = null;
					for (const { message, options, onError } of this.pendingCalls) {
						try {
							worker.postMessage(message, options);
						} catch (error) {
						// 遅延送信の失敗でも待機中のRPCを完了させ、残りの更新は送信する。
							if (onError) onError(error);
							else this.errorMessage.value = error instanceof Error ? error.message : String(error);
						}
					}
					this.pendingCalls = [];
					resolveReady();
					break;
				}
				case 'return': {
					const { id, value, error, success } = event.data;
					const hook = this.returnHooks.get(id);
					if (hook != null) {
						this.returnHooks.delete(id);
						if (success) {
							hook.resolve(value);
						} else {
							const reason = new Error(error.message);
							reason.name = error.name;
							reason.stack = error.stack;
							hook.reject(reason);
						}
					}
					break;
				}
				case 'ev': {
					const { type, ctx } = event.data.ev;
					this.managerEventHandlers[type](ctx);
					break;
				}
				case 'previewError': {
					// 描画できないグラフでも、修正するための更新は送り続ける。
					// 致命的なWorkerエラー後の遅延通知では、そのエラー表示を上書きしない。
					if (this.isReady.value) this.errorMessage.value = event.data.message;
					break;
				}
			}
		};

		await ready;

		this.onCreated();
	}

	public reload(): Promise<void> {
		if (this.reloadPromise) return this.reloadPromise;
		if (!this.worker || this.rejectInitialization != null) return Promise.reject(new Error('Renderer is not initialized'));
		this.disposeManager();
		this.reloadPromise = this.launchManager(true).finally(() => { this.reloadPromise = null; });
		return this.reloadPromise;
	}

	public disposeManager() {
		this.rejectPendingReturns(new Error('Engine reloaded during renderer call'));
		// エクスポート開始時は初期化途中でも破棄する。待機を残すとreloadPromiseが
		// 解決されず、復帰後の設定変更でもWorkerを再読み込みできなくなる。
		this.rejectInitialization?.(new Error('Engine disposed during initialization'));
		this.rejectInitialization = null;
		this.pendingCalls = [];
		this.isReady.value = false;
		this.worker?.terminate();
		this.worker = null;
		this.onDisposed();
	}

	public destroy() {
		this.disposeManager();
	}
}
