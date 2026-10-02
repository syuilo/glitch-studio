import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectGpuContext, EffectImplementation, EffectInstance, EffectOutputData, EffectOutputDataMap, EffectRenderContext, RuntimeEffectParameters } from '@gs/subsystems_effect_shared/effect-implementation.ts';
import type { EffectInstanceState, EffectStatus } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type TimingHelper from '../../renderer/src/utility/TimingHelper.ts';

// 同じ呼び出し元のIDでレンダラーを作り直しても、過去の出力と同じキーに戻さない。
// インスタンスからの通知を無効化する世代とは独立し、描画のたびには更新しない。
let nextResourceVersion = 0;

type RenderContext<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs'>> = Omit<
	EffectRenderContext<Definition['paramDefs'], Definition['outputDefs']>,
	'outputDataMap' | 'createPassEncoderFor' | 'createPassEncoder' | 'createComputePassEncoder'
>;

/**
 * エフェクト1個の実行と、生成した出力・履歴の所有者。
 * 入力・fallback・GPU環境は借用し、評価スコープ・接続・描画順序・submitを扱わない。
 * キャッシュする呼び出し側は必要ポート・解像度の適用とinitializeを済ませてから
 * resourceVersion/cacheVersionを読む。入力の内容更新は呼び出し側のキーで扱う。
 * 返した出力を読むコマンドは、次の描画・再確保・破棄より前に呼び出し側でsubmitする。
 */
export class EffectRenderer<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs'> = EffectDefinition<any, any>> {
	private instance?: EffectInstance<Definition['paramDefs'], Definition['outputDefs']>;
	private instanceGeneration = 0;
	private resourceVersionValue = ++nextResourceVersion;
	private currentResolution?: Resolution;
	private readonly outputs = new Map<string, EffectOutputData>();
	private readonly lazyPorts: string[];
	private status?: EffectStatus;
	private outputState: EffectInstanceState['outputs'];
	private publishedStateKey?: string;
	private readonly statusWaiters = new Set<() => void>();
	private disposed = false;

	constructor(private readonly options: {
		definition: Definition;
		implementation: EffectImplementation<Definition>;
		wgpu: EffectGpuContext;
		fallbackTexture: GPUTexture;
		/** 未確定なら非遅延出力を1x1で仮確保し、初期化前にsetResolutionで確定する。 */
		resolution?: Resolution;
		onState?: (state: EffectInstanceState | null) => void;
		timingHelper?: TimingHelper | null;
		enableStats?: boolean;
	}) {
		this.currentResolution = options.resolution == null ? undefined : { ...options.resolution };
		this.lazyPorts = Object.keys(options.definition.outputDefs).filter(port => options.definition.outputDefs[port].canLazyAllocation);
		this.outputState = this.emptyOutputState();
		try {
			for (const port of Object.keys(options.implementation.outputTextureFactories)) {
				if (!options.definition.outputDefs[port].canLazyAllocation) {
					this.outputs.set(port, this.createOutput(port, this.currentResolution ?? { width: 1, height: 1 }));
				}
			}
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	get resolution(): Readonly<Resolution> | undefined { return this.currentResolution; }
	get resourceVersion(): number { return this.resourceVersionValue; }
	get cacheVersion(): number { return this.instance?.cacheVersion ?? 0; }
	get hasLazyOutputs(): boolean { return this.lazyPorts.length > 0; }

	/** 出力は借用。準備中は未描画のテクスチャも返し、上流の寸法・入力を解決できる。 */
	getOutputTexture(port: Extract<keyof Definition['outputDefs'], string>): GPUTexture | undefined {
		return this.outputs.get(port)?.texture;
	}

	private assertAlive() {
		if (this.disposed) throw new Error('EffectRenderer has been disposed');
	}

	private createOutput(port: string, resolution: Resolution): EffectOutputData {
		const createTexture = this.options.implementation.outputTextureFactories[port];
		const args = { resolution, wgpu: this.options.wgpu };
		let texture: GPUTexture | undefined;
		let previousFrameTexture: GPUTexture | undefined;
		try {
			texture = createTexture(args);
			previousFrameTexture = this.options.implementation.needsPreviousFrame ? createTexture(args) : undefined;
			return { texture, textureView: texture.createView(), previousFrameTexture, previousFrameTextureView: previousFrameTexture?.createView() };
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
					this.outputs.set(port, this.createOutput(port, this.currentResolution ?? { width: 1, height: 1 }));
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

	/** 解像度の選択・倍率適用は呼び出し側で済ませる。同寸法なら履歴もインスタンスも維持する。 */
	setResolution(resolution: Resolution) {
		this.assertAlive();
		if (this.currentResolution?.width === resolution.width && this.currentResolution.height === resolution.height) return;
		// init時の寸法で内部bufferを作る実装もあるため、出力だけを交換しない。
		this.releaseInstance();
		// ポートごとに交換し、全出力の新旧を同時に保持してピークメモリを増やさない。
		// 途中で確保に失敗した場合は寸法を未確定にして、再試行前の描画を防ぐ。
		this.currentResolution = undefined;
		for (const [port, previous] of this.outputs) {
			const output = this.createOutput(port, resolution);
			this.destroyOutput(previous);
			this.outputs.set(port, output);
		}
		this.currentResolution = { ...resolution };
	}

	/** 初期化で変化するcacheVersionも含め、呼び出し側はこの後でキャッシュを判定する。 */
	initialize(params: RuntimeEffectParameters<Definition['paramDefs']>) {
		this.assertAlive();
		if (this.instance != null) return;
		if (this.currentResolution == null) throw new Error('Effect resolution has not been resolved');
		const generation = ++this.instanceGeneration;
		try {
			this.instance = this.options.implementation.init({
				reportStatus: status => {
					if (!this.disposed && this.instanceGeneration === generation) this.setStatus(status);
				},
				resolution: { ...this.currentResolution }, wgpu: this.options.wgpu,
				params, fallbackTexture: this.options.fallbackTexture,
			});
		} catch (error) {
			this.releaseInstance();
			throw error;
		}
		if (this.status == null) this.setStatus({ type: 'ready' });
	}

	/** 準備の開始だけを行う。描画・履歴交換はせず、リクエスト同士の競合管理は各実装に任せる。 */
	prepare(params: RuntimeEffectParameters<Definition['paramDefs']>) {
		this.initialize(params);
		this.instance!.prepare?.(params);
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
		this.initialize(context.params);
		this.setUsedOutputPorts(context.usedOutputPorts);
		const outputDataMap: Record<string, EffectOutputData> = {};
		const needsPreviousFrame = this.options.implementation.needsPreviousFrame;
		for (const [port, output] of this.outputs) {
			outputDataMap[port] = {
				// 公開中の結果を前回値として読み、もう1枚へ書く。成功するまでは公開先を変更しない。
				previousFrameTexture: needsPreviousFrame ? output.texture : undefined,
				previousFrameTextureView: needsPreviousFrame ? output.textureView : undefined,
				texture: needsPreviousFrame ? output.previousFrameTexture! : output.texture,
				textureView: needsPreviousFrame ? output.previousFrameTextureView! : output.textureView,
			};
		}
		this.instance!.render({
			...context, outputDataMap: outputDataMap as EffectOutputDataMap<Definition['outputDefs']>,
			createPassEncoderFor: this.createPassEncoderFor,
			createPassEncoder: this.createPassEncoder,
			createComputePassEncoder: this.createComputePassEncoder,
		});
		if (needsPreviousFrame) {
			for (const [port, output] of Object.entries(outputDataMap)) this.outputs.set(port, output);
		}
		this.outputState = Object.fromEntries(Object.keys(this.options.definition.outputDefs).map(port => {
			const texture = this.outputs.get(port)?.texture;
			return [port, texture == null ? null : { width: texture.width, height: texture.height }];
		}));
		this.publishState();
	}

	private createPassEncoderFor = (encoder: GPUCommandEncoder, view: GPUTextureView): GPURenderPassEncoder => this.createPassEncoder(encoder, {
		colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
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

	/** 出力寸法の公開だけを取り消す。呼び出し側で利用を休止しても、出力・履歴は破棄しない。 */
	clearOutputState() {
		this.outputState = this.emptyOutputState();
		this.publishState();
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
		// dispose中に同期通知する実装もあり得るため、先に世代と待機を無効化する。
		++this.instanceGeneration;
		this.resourceVersionValue = ++nextResourceVersion;
		const instance = this.instance;
		this.instance = undefined;
		const hadStatus = this.status != null;
		this.status = undefined;
		this.outputState = this.emptyOutputState();
		this.publishedStateKey = undefined;
		for (const notify of this.statusWaiters) notify();
		if (hadStatus) this.options.onState?.(null);
		instance?.dispose();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.releaseInstance();
		for (const output of this.outputs.values()) this.destroyOutput(output);
		this.outputs.clear();
	}
}
