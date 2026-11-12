import { EffectGpuCommandRecorder } from './effect-gpu-command-recorder.ts';
import { EffectRenderTileController } from './effect-render-tile-controller.ts';
import type { EffectRenderTiling, EffectRenderWorkloadHint, EffectRenderTilingProgressObserver } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import { createEffectRenderDevice, trackEffectRenderTexture } from './effect-render-texture-views.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectGpuContext, EffectImplementation, EffectInstance, EffectOutputData, EffectOutputDataMap, EffectRenderContext, RuntimeEffectParameters, EffectStaticResources } from '@gs/subsystems_effect_shared/effect-implementation.ts';
import type { EffectInstanceState, EffectStatus } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import TimingHelper from '@gs/shared/gpu/TimingHelper.ts';

// 同じ呼び出し元のIDでレンダラーを作り直しても、過去の出力と同じキーに戻さない。
// インスタンスからの通知を無効化する世代とは独立し、描画のたびには更新しない。
let nextResourceVersion = 0;

/** ポインターを含む入力は、エフェクト実装と同じ共通単位で受け取る。 */
type RenderContext<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs' | 'staticSettingDefs'>> = Omit<
	EffectRenderContext<Definition['paramDefs'], Definition['outputDefs']>,
	'outputDataMap' | 'createPassEncoderFor' | 'createPassEncoder' | 'createComputePassEncoder'
>;

/**
 * エフェクト1個の実行と、生成した出力・履歴の所有者。
 * 入力・fallback・GPU環境は借用し、評価スコープ・接続は扱わない。
 * 通常描画のsubmitは呼び出し側が所有し、タイル描画だけはエフェクト単位で送信・完了待ちを行う。
 * 解像度と借用リソースは生成時に固定する。キャッシュする呼び出し側は必要ポートの適用とinitializeを済ませてから
 * resourceVersion/cacheVersionを読む。入力の内容更新は呼び出し側のキーで扱う。
 * 返した出力を読むコマンドは、次の描画・再確保・破棄より前に呼び出し側でsubmitする。
 */
export class EffectRenderer<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs' | 'staticSettingDefs' | 'canHaveLongRunningRenderPass'> = EffectDefinition<any, any>> {
	private instance: EffectInstance<Definition['paramDefs'], Definition['outputDefs']> | null = null;
	private instanceGeneration = 0;
	private resourceVersionValue = ++nextResourceVersion;
	public readonly resolution: Readonly<Resolution>;
	private readonly outputs = new Map<string, EffectOutputData>();
	private readonly lazyPorts: string[];
	private status: EffectStatus | null = null;
	private outputState: EffectInstanceState['outputs'];
	private publishedStateKey: string | null = null;
	private readonly statusWaiters = new Set<() => void>();
	private disposed = false;
	private renderHistoryResetPending = false;
	private readonly effectGpuContext: EffectGpuContext;
	private tiledRenderController: AbortController | null = null;
	private tiledTimingHelper: TimingHelper | null = null;
	private pendingHistoryReset = false;
	private readonly tileController: EffectRenderTileController | null;
	public readonly requiresTiledRendering: boolean;
	private pendingWorkloadHint: { context: Omit<RenderContext<Definition>, 'commandEncoder'>; hint: EffectRenderWorkloadHint | null } | null = null;
	private untiledFramesUntilMeasurement = 0;

	constructor(private readonly options: {
		definition: Definition;
		implementation: EffectImplementation<Definition>;
		wgpu: EffectGpuContext;
		fallbackTexture: GPUTexture;
		/** 静的設定の変更ではEffectRenderer自体を作り直す。借用リソースを途中で差し替えない。 */
		readonly staticResources: EffectStaticResources<Definition>;
		/** 出力の確保・初期化より前に、呼び出し側が静的に解決した寸法。 */
		readonly resolution: Resolution;
		onState?: (state: EffectInstanceState | null) => void;
		timingHelper?: TimingHelper | null;
		enableStats?: boolean;
		effectRenderTiling?: EffectRenderTiling;
	}) {
		const tiling = options.effectRenderTiling ?? { mode: 'auto' };
		this.requiresTiledRendering = tiling.mode === 'manual' || (tiling.mode === 'auto' && options.definition.canHaveLongRunningRenderPass === true);
		this.tileController = tiling.mode === 'auto' && options.definition.canHaveLongRunningRenderPass === true ? new EffectRenderTileController() : null;
		this.effectGpuContext = this.requiresTiledRendering
			? { ...options.wgpu, device: createEffectRenderDevice(options.wgpu.device) } : options.wgpu;
		this.resolution = { ...options.resolution };
		this.lazyPorts = Object.keys(options.definition.outputDefs).filter(port => options.definition.outputDefs[port].canLazyAllocation);
		this.outputState = this.emptyOutputState();
		try {
			for (const port of Object.keys(options.implementation.outputTextureFactories)) {
				if (!options.definition.outputDefs[port].canLazyAllocation) {
					this.outputs.set(port, this.createOutput(port));
				}
			}
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	get resourceVersion(): number { return this.resourceVersionValue; }
	get cacheVersion(): number { return this.instance?.cacheVersion ?? 0; }
	get hasLazyOutputs(): boolean { return this.lazyPorts.length > 0; }

	/** 呼び出し側が履歴依存のあるエフェクトに対して実行する。借用リソース・解像度は維持する。 */
	resetRenderHistory() {
		this.assertAlive();
		if (this.tiledRenderController != null) {
			this.pendingHistoryReset = true;
			this.tiledRenderController.abort();
			return;
		}
		// 履歴は共通の前フレームだけでなく、実装内のGPU資源・カウンター等にも存在する。
		// 実行インスタンスごと初期化し、個々のエフェクトの履歴管理方式に依存しない。
		this.releaseInstance();
		const allocatedPorts = [...this.outputs.keys()];
		for (const output of this.outputs.values()) this.destroyOutput(output);
		this.outputs.clear();
		try {
			for (const port of allocatedPorts) this.outputs.set(port, this.createOutput(port));
		} catch (error) {
			this.dispose();
			throw error;
		}
		this.renderHistoryResetPending = true;
	}

	/** 出力は借用。準備中は未描画のテクスチャも返し、上流の寸法・入力を解決できる。 */
	getOutputTexture(port: Extract<keyof Definition['outputDefs'], string>): GPUTexture | null {
		return this.outputs.get(port)?.texture ?? null;
	}

	private assertAlive() {
		if (this.disposed) throw new Error('EffectRenderer has been disposed');
	}

	private createOutput(port: string): EffectOutputData {
		const createTexture = this.options.implementation.outputTextureFactories[port];
		const args = { resolution: { ...this.resolution }, wgpu: this.effectGpuContext };
		let texture: GPUTexture | null = null;
		let previousFrameTexture: GPUTexture | null = null;
		try {
			texture = createTexture(args);
			previousFrameTexture = this.options.implementation.needsPreviousFrame ? createTexture(args) : null;
			return {
				texture,
				textureView: (this.requiresTiledRendering ? trackEffectRenderTexture(texture) : texture).createView(),
				previousFrameTexture,
				previousFrameTextureView: previousFrameTexture == null ? null : (this.requiresTiledRendering ? trackEffectRenderTexture(previousFrameTexture) : previousFrameTexture).createView(),
			};
		} catch (error) {
			texture?.destroy();
			previousFrameTexture?.destroy();
			throw error;
		}
	}

	private destroyOutput(output: EffectOutputData) {
		output.texture.destroy();
		output.previousFrameTexture?.destroy();
	}

	/** 必要ポートの収集は呼び出し側が行う。省略は全出力、空集合は利用なし。 */
	setUsedOutputPorts(ports?: ReadonlySet<Extract<keyof Definition['outputDefs'], string>>) {
		this.assertAlive();
		for (const port of this.lazyPorts) {
			const output = this.outputs.get(port);
			if (ports == null || ports.has(port as Extract<keyof Definition['outputDefs'], string>)) {
				if (output == null) {
					this.outputs.set(port, this.createOutput(port));
					this.resourceVersionValue = ++nextResourceVersion;
				}
			} else if (output != null) {
				this.destroyOutput(output);
				this.outputs.delete(port);
				this.resourceVersionValue = ++nextResourceVersion;
				this.outputState = { ...this.outputState, [port]: null };
				this.publishState();
			}
		}
	}

	/** 初期化で変化するcacheVersionも含め、呼び出し側はこの後でキャッシュを判定する。 */
	initialize(params: RuntimeEffectParameters<Definition['paramDefs']>) {
		this.assertAlive();
		if (this.instance != null) return;
		const generation = ++this.instanceGeneration;
		try {
			this.instance = this.options.implementation.init({
				reportStatus: status => {
					if (!this.disposed && this.instanceGeneration === generation) this.setStatus(status);
				},
				resolution: { ...this.resolution },
				wgpu: this.effectGpuContext,
				params,
				resources: this.options.staticResources,
				fallbackTexture: this.options.fallbackTexture,
			});
		} catch (error) {
			this.releaseInstance();
			throw error;
		}
		if (this.status == null) this.setStatus({ type: 'ready' });
	}

	/** 準備の開始だけを行う。描画・履歴交換はせず、リクエスト同士の競合管理は各実装に任せる。 */
	prepare(params: RuntimeEffectParameters<Definition['paramDefs']>, signal?: AbortSignal) {
		this.initialize(params);
		this.instance!.prepare?.(params, signal);
	}

	/** 同期の描画ループ用。準備中はfalse、準備失敗は元の診断で通知する。 */
	checkReady(): boolean {
		if (this.disposed || this.instance == null) return false;
		if (this.status?.type === 'error') throw new Error(this.status.message);
		return this.status?.type !== 'loading';
	}

	/** falseは待機の中断または対象インスタンスの破棄・再初期化。中断だけでdisposeはしない。 */
	waitUntilReady(signal: AbortSignal): Promise<boolean> {
		// 同期エフェクトには待機リスナーを作らない。非同期準備を持つものだけ監視する。
		if (signal.aborted || this.disposed || this.instance == null) return Promise.resolve(false);
		if (this.status?.type === 'error') return Promise.reject(new Error(this.status.message));
		if (this.status?.type !== 'loading') return Promise.resolve(true);
		const generation = this.instanceGeneration;
		return new Promise((resolve, reject) => {
			const check = () => {
				const cancelled = signal.aborted || this.disposed || this.instanceGeneration !== generation || this.instance == null;
				if (!cancelled && this.status?.type === 'loading') return;
				this.statusWaiters.delete(check);
				signal.removeEventListener('abort', check);
				if (!cancelled && this.status?.type === 'error') reject(new Error(this.status.message));
				else resolve(!cancelled);
			};
			this.statusWaiters.add(check);
			signal.addEventListener('abort', check);
			check();
		});
	}

	render(context: RenderContext<Definition>) {
		this.recordRender(context)();
	}

	/** 十分軽いことを実測した条件では、通常描画へ戻して計測も間引く。 */
	shouldRenderTiled(context: Omit<RenderContext<Definition>, 'commandEncoder'>): boolean {
		if (!this.requiresTiledRendering) return false;
		if (this.options.effectRenderTiling?.mode === 'manual') return true;
		const hint = this.options.implementation.getRenderWorkloadHint?.(context) ?? null;
		this.pendingWorkloadHint = { context, hint };
		if (this.tileController?.canRenderUntiled(hint) === true && this.untiledFramesUntilMeasurement > 0) {
			this.untiledFramesUntilMeasurement--;
			return false;
		}
		return true;
	}

	/** エフェクト実装は同期のまま一度だけ呼び、GPU実行の成功後に出力と履歴を公開する。 */
	async renderTiled(context: Omit<RenderContext<Definition>, 'commandEncoder'>, signal?: AbortSignal,
		onProgress?: EffectRenderTilingProgressObserver | null): Promise<number> {
		this.assertAlive();
		signal?.throwIfAborted();
		if (this.tiledRenderController != null) throw new Error('Effect tiled render is already running.');
		const controller = new AbortController();
		this.tiledRenderController = controller;
		const renderSignal = signal == null ? controller.signal : AbortSignal.any([signal, controller.signal]);
		try {
			renderSignal.throwIfAborted();
			const tiling = this.options.effectRenderTiling ?? { mode: 'auto' };
			let workloadHint: EffectRenderWorkloadHint | null = null;
			if (tiling.mode === 'auto' && this.options.definition.canHaveLongRunningRenderPass === true) {
				workloadHint = this.pendingWorkloadHint?.context === context ? this.pendingWorkloadHint.hint
					: this.options.implementation.getRenderWorkloadHint?.(context) ?? null;
			}
			this.pendingWorkloadHint = null;
			const recorder = new EffectGpuCommandRecorder();
			const commit = this.recordRender({ ...context, commandEncoder: recorder.encoder }, recorder);
			if (this.options.enableStats === true) this.tiledTimingHelper ??= new TimingHelper(this.options.wgpu.device);
			const gpuTime = await recorder.execute(this.options.wgpu.device, tiling, renderSignal, this.tiledTimingHelper,
				this.tileController, workloadHint, onProgress);
			renderSignal.throwIfAborted();
			commit();
			this.untiledFramesUntilMeasurement = this.tileController?.canRenderUntiled(workloadHint) === true ? 30 : 0;
			return gpuTime;
		} catch (error) {
			// CPUカウンターや中間画像も変更され得るため、中断された実装を次回に再利用しない。
			this.tileController?.reset();
			this.pendingHistoryReset = true;
			this.tiledTimingHelper?.dispose();
			this.tiledTimingHelper = null;
			throw error;
		} finally {
			this.tiledRenderController = null;
			if (this.disposed) this.releaseResources();
			else if (this.pendingHistoryReset) {
				this.pendingHistoryReset = false;
				this.resetRenderHistory();
			}
			onProgress?.(null);
		}
	}

	private recordRender(context: RenderContext<Definition>, recorder: EffectGpuCommandRecorder | null = null): () => void {
		this.initialize(context.params);
		this.setUsedOutputPorts(context.usedOutputPorts);
		const outputDataMap: Record<string, EffectOutputData> = {};
		const needsPreviousFrame = this.options.implementation.needsPreviousFrame;
		for (const [port, output] of this.outputs) {
			outputDataMap[port] = {
				// 公開中の結果を前回値として読み、もう1枚へ書く。成功するまでは公開先を変更しない。
				previousFrameTexture: needsPreviousFrame ? output.texture : null,
				previousFrameTextureView: needsPreviousFrame ? output.textureView : null,
				texture: needsPreviousFrame ? output.previousFrameTexture! : output.texture,
				textureView: needsPreviousFrame ? output.previousFrameTextureView! : output.textureView,
			};
		}
		this.instance!.render({
			...context,
			// リセット前からの時間・移動量を新しい履歴へ積算しない。絶対時刻は保持する。
			timeDelta: this.renderHistoryResetPending ? 0 : context.timeDelta,
			pointerVector: this.renderHistoryResetPending ? { x: 0, y: 0 } : context.pointerVector,
			outputDataMap: outputDataMap as EffectOutputDataMap<Definition['outputDefs']>,
			createPassEncoderFor: recorder == null ? this.createPassEncoderFor : (_encoder, view) => recorder.beginRenderPass({
				colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
			}),
			createPassEncoder: recorder == null ? this.createPassEncoder : (_encoder, descriptor) => recorder.beginRenderPass(descriptor),
			createComputePassEncoder: recorder == null ? this.createComputePassEncoder : (_encoder, descriptor) => recorder.beginComputePass(descriptor),
		});
		return () => {
			this.renderHistoryResetPending = false;
			if (needsPreviousFrame) {
				for (const [port, output] of Object.entries(outputDataMap)) this.outputs.set(port, output);
			}
			this.outputState = Object.fromEntries(Object.keys(this.options.definition.outputDefs).map(port => {
				const texture = this.outputs.get(port)?.texture;
				return [port, texture == null ? null : { width: texture.width, height: texture.height }];
			}));
			this.publishState();
		};
	}

	private createPassEncoderFor = (encoder: GPUCommandEncoder, view: GPUTextureView): GPURenderPassEncoder => this.createPassEncoder(encoder, {
		colorAttachments: [{
			view,
			clearValue: {
				r: 0,
				g: 0,
				b: 0,
				a: 1,
			},
			loadOp: 'clear',
			storeOp: 'store',
		}],
	});

	private createPassEncoder = (encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor): GPURenderPassEncoder => {
		return this.options.enableStats && this.options.timingHelper != null
			? this.options.timingHelper.beginRenderPass(encoder, descriptor) : encoder.beginRenderPass(descriptor);
	};

	private createComputePassEncoder = (encoder: GPUCommandEncoder, descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder => {
		return this.options.enableStats && this.options.timingHelper != null
			? this.options.timingHelper.beginComputePass(encoder, descriptor) : encoder.beginComputePass(descriptor);
	};

	private emptyOutputState(): EffectInstanceState['outputs'] {
		return Object.fromEntries(Object.keys(this.options.definition.outputDefs).map(port => [port, null]));
	}

	private setStatus(status: EffectStatus) {
		const previous = this.status;
		if (previous?.type === status.type && (status.type !== 'error' || (previous.type === 'error' && previous.message === status.message))) return;
		this.status = status;
		for (const notify of this.statusWaiters) notify();
		this.publishState();
	}

	private publishState() {
		if (this.status == null) return;
		const state: EffectInstanceState = { status: this.status, outputs: this.outputState };
		const key = JSON.stringify(state);
		if (this.publishedStateKey === key) return;
		this.publishedStateKey = key;
		this.options.onState?.(state);
	}

	private releaseInstance() {
		this.tileController?.reset();
		this.pendingWorkloadHint = null;
		this.untiledFramesUntilMeasurement = 0;
		// dispose中に同期通知する実装もあり得るため、先に世代と待機を無効化する。
		++this.instanceGeneration;
		this.resourceVersionValue = ++nextResourceVersion;
		const instance = this.instance;
		this.instance = null;
		const hadStatus = this.status != null;
		this.status = null;
		this.outputState = this.emptyOutputState();
		this.publishedStateKey = null;
		for (const notify of this.statusWaiters) notify();
		if (hadStatus) this.options.onState?.(null);
		instance?.dispose();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		if (this.tiledRenderController != null) {
			this.tiledRenderController.abort();
			return;
		}
		this.releaseResources();
	}

	private releaseResources() {
		this.tiledTimingHelper?.dispose();
		this.tiledTimingHelper = null;
		this.releaseInstance();
		for (const output of this.outputs.values()) this.destroyOutput(output);
		this.outputs.clear();
	}
}
