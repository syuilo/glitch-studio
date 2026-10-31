import { ref } from 'vue';
import type { VisualModuleRendererManager } from '@gs/glitch-studio_renderer/visual-module-renderer-manager.ts';
import type { TimelineRendererManager } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { RenderFailureOrigin } from './utility/render-failure.ts';

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
	private rejectInitialization: ((reason: Error) => void) | null = null;
	private generation = 0;
	private createWorker: () => Worker | Promise<Worker>;
	private managerEventHandlers: ManagerEventHandlers<T>;
	private onCreated: (() => void);
	private onDisposed: (() => void);
	private onError: (error: Error | null) => void;

	public readonly isReady = ref(false);
	public onRenderFailure?: (error: Error, origin?: RenderFailureOrigin) => void;

	protected reportRenderFailure(error: Error, origin?: RenderFailureOrigin) {
		// Visual Module Live Preview・Timelineの破棄は所有者がまとめて行う。ここでは同じManagerを重ねて破棄しない。
		this.onRenderFailure?.(error, origin);
		this.onError(error);
	}

	constructor(options: {
		createWorker: RendererManagerControllerBase<T>['createWorker'];
		eventHandlers: RendererManagerControllerBase<T>['managerEventHandlers'];
		onCreated: RendererManagerControllerBase<T>['onCreated'];
		onDisposed: RendererManagerControllerBase<T>['onDisposed'];
		onError: RendererManagerControllerBase<T>['onError'];
	}) {
		this.createWorker = options.createWorker;
		this.managerEventHandlers = options.eventHandlers;
		this.onCreated = options.onCreated;
		this.onDisposed = options.onDisposed;
		this.onError = options.onError;
	}

	protected call<FN extends keyof ManagerMethods<T>>(fn: FN, args: Parameters<ManagerMethods<T>[FN]>, options?: StructuredSerializeOptions | Transferable[]): void {
		if (!this.isReady.value || this.worker == null) throw new Error('Renderer is not initialized');
		this.worker.postMessage({ type: 'call', fn, args }, Array.isArray(options) ? { transfer: options } : options);
	}

	private returnHooks = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
	private callCounter = 0;

	// 初期化中の編集は所有者がWorkerごと破棄する。未起動のWorkerへRPCを予約しない。
	protected async callAndWaitReturn<FN extends keyof ManagerMethods<T>>(fn: FN, args: Parameters<ManagerMethods<T>[FN]>, options?: StructuredSerializeOptions | Transferable[]): Promise<Awaited<ReturnType<ManagerMethods<T>[FN]>>> {
		if (!this.isReady.value || this.worker == null) throw new Error('Renderer is not initialized');
		return new Promise<Awaited<ReturnType<ManagerMethods<T>[FN]>>>((resolve, reject) => {
			const id = this.callCounter++;
			this.returnHooks.set(id, { resolve: value => resolve(value as Awaited<ReturnType<ManagerMethods<T>[FN]>>), reject });
			try {
				this.worker!.postMessage({ type: 'call', fn, args, needReturnValue: true, id }, Array.isArray(options) ? { transfer: options } : options);
			} catch (error) {
				this.returnHooks.delete(id);
				reject(error);
			}
		});
	}

	private rejectPendingReturns(error: Error) {
		// 終了したWorkerからは応答が来ないため、呼び出し側の待機も必ず解除する。
		for (const hook of this.returnHooks.values()) hook.reject(error);
		this.returnHooks.clear();
	}

	protected async launchManager(prepare: () => { options: Record<string, unknown>; transfer: Transferable[] }) {
		if (this.worker != null || this.rejectInitialization != null) throw new Error('Renderer is already initialized or initializing');
		const generation = ++this.generation;
		const isCurrent = () => generation === this.generation;
		const { promise: ready, resolve: resolveReady, reject: rejectReady } = Promise.withResolvers<void>();
		this.rejectInitialization = rejectReady;

		const fail = (reason: unknown) => {
			if (!isCurrent()) return;
			const error = reason instanceof Error ? reason : new Error(String(reason));
			// 障害後に届いたinitedや描画通知で利用可能な状態へ戻さない。
			rejectReady(error);
			this.reportRenderFailure(error);
		};

		const initialize = async () => {
			// Canvas差し替え等の同期通知でも破棄され得るため、準備より先に世代と待機を所有する。
			const initial = prepare();
			if (!isCurrent()) return;
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
						// エラーからの復旧は新しいManagerの生成で行うため、初期化完了時に解除する。
						this.onError(null);
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
								this.reportRenderFailure(reason);
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
						this.reportRenderFailure(new Error(event.data.message));
						break;
					}
				}
			};
			worker.postMessage({ type: 'init', ...initial.options }, initial.transfer);
		};

		// 準備の完了とは独立してreadyを待ち、生成が未完了でも破棄時に呼び出し元を解放する。
		void initialize().catch(fail);
		await ready;
		if (!isCurrent()) throw new Error('Engine disposed during initialization');
		this.onCreated();
	}

	public disposeManager(reason?: Error) {
		this.generation++;
		this.rejectPendingReturns(reason ?? new Error('Engine reloaded during renderer call'));
		// 初期化途中でも待機をrejectし、所有者が最新スナップショットで起動し直せるようにする。
		this.rejectInitialization?.(reason ?? new Error('Engine disposed during initialization'));
		this.rejectInitialization = null;
		this.isReady.value = false;
		this.worker?.terminate();
		this.worker = null;
		this.onDisposed();
	}

	public destroy() {
		this.disposeManager();
	}
}
