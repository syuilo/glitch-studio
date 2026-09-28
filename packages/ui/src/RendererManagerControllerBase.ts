import { ref } from 'vue';
import type { VisualModuleRendererManager } from '@glitch/renderer/visual-module-renderer-manager.ts';
import type { TimelineRendererManager } from '@glitch/renderer/timeline-renderer-manager.ts';

type ManagerMethods<T> = {
	[K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: Extract<T[K], (...args: never[]) => unknown>;
};

type RendererManager = VisualModuleRendererManager | TimelineRendererManager;
type ManagerEvent<T extends RendererManager> = Parameters<T['emit']>[1];
type ManagerEventHandlers<T extends RendererManager> = {
	[E in ManagerEvent<T> as E['type']]: (ctx: E['ctx']) => void;
};

// 対象のRendererManagerがWorker越しに動いているのか直接動いているのか隠蔽するクラス(現在はworkerのみ)
export abstract class RendererManagerControllerBase<T extends RendererManager> {
	private worker: Worker | null = null;
	private reloadPromise: Promise<void> | null = null;
	private rejectInitialization: ((reason: Error) => void) | null = null;
	private generation = 0;
	private pendingCalls: { message: unknown; options?: StructuredSerializeOptions; onError?: (error: unknown) => void }[] = [];

	private getInitialOptions: ((isReload: boolean) => Promise<{ options: Record<string, unknown>; transfer: Transferable[] }>);
	private createWorker: () => Worker | Promise<Worker>;
	private managerEventHandlers: ManagerEventHandlers<T>;
	private onCreated: (() => void);
	private onDisposed: (() => void);
	private onError: (error: Error | null) => void;

	public readonly isReady = ref(false);

	protected get isInitializing(): boolean {
		return this.rejectInitialization != null;
	}

	protected get hasManager(): boolean {
		return this.worker != null;
	}

	constructor(options: {
		getInitialOptions: RendererManagerControllerBase<T>['getInitialOptions'];
		createWorker: RendererManagerControllerBase<T>['createWorker'];
		eventHandlers: RendererManagerControllerBase<T>['managerEventHandlers'];
		onCreated: RendererManagerControllerBase<T>['onCreated'];
		onDisposed: RendererManagerControllerBase<T>['onDisposed'];
		onError: RendererManagerControllerBase<T>['onError'];
	}) {
		this.getInitialOptions = options.getInitialOptions;
		this.createWorker = options.createWorker;
		this.managerEventHandlers = options.eventHandlers;
		this.onCreated = options.onCreated;
		this.onDisposed = options.onDisposed;
		this.onError = options.onError;
	}

	protected call<FN extends keyof ManagerMethods<T>>(fn: FN, args: Parameters<ManagerMethods<T>[FN]>, options?: StructuredSerializeOptions | Transferable[]): void {
		//console.log('Calling renderer method:', fn, 'with args:', args);
		const message = { type: 'call', fn, args };
		const serializeOptions = Array.isArray(options) ? { transfer: options } : options;
		if (!this.isReady.value) {
			if (this.isInitializing) {
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
	protected async callAndWaitReturn<FN extends keyof ManagerMethods<T>>(fn: FN, args: Parameters<ManagerMethods<T>[FN]>, options?: StructuredSerializeOptions | Transferable[]): Promise<Awaited<ReturnType<ManagerMethods<T>[FN]>>> {
		const serializeOptions = Array.isArray(options) ? { transfer: options } : options;
		if (!this.isReady.value && this.rejectInitialization == null) {
			throw new Error('Renderer is not initialized');
		}
		if (this.worker != null || this.isInitializing) {
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
		if (this.worker != null || this.isInitializing) throw new Error('Renderer is already initialized or initializing');
		const generation = ++this.generation;
		const isCurrent = () => generation === this.generation;
		const { promise: ready, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers<void>();
		this.rejectInitialization = rejectReady;

		const fail = (reason: unknown) => {
			if (!isCurrent()) return;
			const error = reason instanceof Error ? reason : new Error(String(reason));
			// 障害後に届いたinitedや描画通知で利用可能な状態へ戻さない。
			this.generation++;
			this.isReady.value = false;
			this.rejectPendingReturns(error);
			rejectReady(error);
			this.rejectInitialization = null;
			this.pendingCalls = [];
			this.onError(error);
		};

		const initialize = async () => {
			const worker = await this.createWorker();
			// 生成中に破棄されても、遅れて得たWorkerの所有権を残さない。
			if (!isCurrent()) {
				worker.terminate();
				return;
			}
			this.worker = worker;
			worker.onerror = event => fail(new Error(event.message || 'Renderer worker failed'));
			worker.onmessage = (event) => {
				if (!isCurrent()) return;
				switch (event.data?.type) {
					case 'initError': {
						fail(new Error(event.data.message));
						break;
					}
					case 'inited': {
						this.isReady.value = true;
						this.rejectInitialization = null;
						// 新しいManagerは正常描画時のnull通知を省略するため、ここで解除する。
						this.onError(null);
						for (const { message, options, onError } of this.pendingCalls) {
							try {
								worker.postMessage(message, options);
							} catch (error) {
								// 遅延送信の失敗でも待機中のRPCを完了させ、残りの更新は送信する。
								if (onError) onError(error);
								else this.onError(error instanceof Error ? error : new Error(String(error)));
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
						const { type, ctx } = event.data.ev as ManagerEvent<T>;
						// Workerは同じManagerのイベントを転送する。動的なキー選択では失われる
						// typeとctxの対応だけを通信境界で補い、登録側ではイベントごとの型を保つ。
						const handler = this.managerEventHandlers[type as keyof ManagerEventHandlers<T>] as (ctx: ManagerEvent<T>['ctx']) => void;
						handler(ctx);
						break;
					}
					case 'callError': {
						this.onError(new Error(event.data.message));
						break;
					}
				}
			};
			const { options: initOptions, transfer: initTransfer } = await this.getInitialOptions(isReload);
			if (!isCurrent()) return;
			worker.postMessage({ type: 'init', ...initOptions }, initTransfer);
		};

		// 準備の完了とは独立してreadyを待ち、生成が未完了でも破棄時に呼び出し元を解放する。
		void initialize().catch(fail);
		await ready;
		if (!isCurrent()) throw new Error('Engine disposed during initialization');
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
		this.generation++;
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

	/** エクスポート等で解放したManagerを、保持中の設定と新しいCanvasで再生成する。 */
	public async relaunchManager(): Promise<void> {
		// 破棄によってrejectされたreloadの後処理を先に終わらせる。
		await this.reloadPromise?.catch(() => {});
		await this.launchManager(true);
	}

	public destroy() {
		this.disposeManager();
	}
}
