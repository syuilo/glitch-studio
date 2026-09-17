import { createTextureFromSource, makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import * as AiScript from '@syuilo/aiscript';
import { evalAutomationValue, genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { playerAudioSourceId } from '@glitch/shared/audio.ts';
import { AudioHistory } from '@glitch/shared/audio-history.ts';
import { float32ToFloat16Bits } from '@glitch/shared/utility/float32ToFloat16Bits.ts';
import { effectImplementations } from '@glitch/shared/effect-implementations.js';
import defaultVertexShaderCode from './vertex.wgsl?raw';
import TimingHelper from './utility/TimingHelper.ts';
import { getEvaluatedParam, mapNodeParam, walkNodeParams } from './utility/node-params.ts';
import finalRenderShaderCode from './render.wgsl?raw';
import { NonNegativeRollingAverage } from './utility/NonNegativeRollingAverage.ts';
import { GpuHistogram } from './utility/histogram/GpuHistogram.ts';
import { GpuWaveform } from './utility/waveform/GpuWaveform.ts';
import { GpuMemoryTracker } from './utility/GpuMemoryTracker.ts';
import type { EffectStatus } from '@glitch/shared/effect-status.ts';
import type { AudioCaptureMessage, AudioSourceId } from '@glitch/shared/audio.ts';
import type { Asset, Macro, GsAutomation, GsEffectNode, GsNode, GsGroupNode, Player, NodeOutputReference, EffectParamDef } from '@glitch/shared/types.ts';
import type { EffectInstance, IntermediateTextureFormat } from '@glitch/shared/effect-implementation.js';

const aisParser = new AiScript.Parser();

const aiscript = new AiScript.Interpreter({});

// TODO: 毎回parseしているのが無駄感あるからどうにかする
function evaluateExpression(expression: string, scope: Record<string, any>, paramDefForFallback: Omit<EffectParamDef, 'default'>): any {
	try {
		for (const key in scope) {
			if (aiscript.scope.exists(key)) {
				aiscript.scope.assign(key, AiScript.utils.jsToVal(scope[key]));
			} else {
				aiscript.scope.add(key, { isMutable: true, value: AiScript.utils.jsToVal(scope[key]) });
			}
		}
		const aisVal = aiscript.execSync(aisParser.parse(expression));
		if (aisVal === undefined) return null;
		return AiScript.utils.valToJs(aisVal);
	} catch (err) { // パース失敗時など
		return genEmptyValue(paramDefForFallback);
	}
}

function serializeAsset(asset: Asset | undefined) {
	if (asset == null) return null;
	return {
		id: asset.id,
		width: asset.width,
		height: asset.height,
		data: asset.data,
		hash: asset.hash,
	};
}

function getEffectNodes(nodes: GsNode[]): GsEffectNode[] {
	return nodes.flatMap(node => node.type === 'group' ? getEffectNodes(node.nodes) : [node]);
}

export class Renderer {
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private resolution: { width: number; height: number; };
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private fallbackScalarFieldTexture: GPUTexture;
	private enableStats = true;
	private highlightClipping = false;
	private timeFactor = 1;
	private nodes: GsNode[] = [];
	private allNodeIdMap: Map<GsNode['id'], GsNode> = new Map(); // group内のnodeもフラット化して含む。高速に特定のノードを見つける用のキャッシュ
	private assets: Asset[] = [];
	private macros: Macro[] = [];
	private automations: GsAutomation[] = [];
	private assetTextures: Map<string, GPUTexture> = new Map();
	private videoFrames: Map<Player['id'], VideoFrame> = new Map();
	private videoFrameVersions: Map<Player['id'], number> = new Map();
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private audioPorts = new Map<AudioSourceId, MessagePort>();
	private effectInstances: Map<GsEffectNode['id'], EffectInstance | null> = new Map();
	private effectPerParamConstFieldTextures: Map<GsEffectNode['id'], Record<string, GPUTexture>> = new Map();
	private outDataMapPerNodes: Map<GsEffectNode['id'], Record<string, {
		texture: GPUTexture;
		textureView: GPUTextureView;
		previousFrameTexture?: GPUTexture;
		previousFrameTextureView?: GPUTextureView;
	}>> = new Map();
	private effectCacheKeys: Map<GsEffectNode['id'], string> = new Map();
	private timingHelper: TimingHelper;
	private finalRenderSampler: GPUSampler;
	private finalRenderPipeline: GPURenderPipeline;
	private finalRenderUniformValues: ReturnType<typeof makeStructuredView>;
	private finalRenderUniformBuffer: GPUBuffer;
	private finalRenderBindGroup: GPUBindGroup | null = null;
	private finalRenderInputTexture: GPUTexture | null = null;
	private enable32bitDataTextures = false;
	private readonly intermediateTextureFormat: IntermediateTextureFormat;
	private evaledNodeParams: Map<GsNode['id'], Record<string, any>> = new Map();
	private latestTimestamp: number = performance.now();
	private pointerPosition: { x: number; y: number } = { x: -99999, y: -99999 };
	private pointerPositionPrev: { x: number; y: number } = { x: -99999, y: -99999 };
	private lastPointerUpdateTimestamp = 0;
	private histogramGpuContext: GPUCanvasContext;
	private waveformHorizontalGpuContext: GPUCanvasContext;
	private gpuHistogram: GpuHistogram;
	private gpuWaveformHorizontal: GpuWaveform;
	private gpuWaveformVertical: GpuWaveform;
	private timeDelta = 0;
	public gpuAverageFast = new NonNegativeRollingAverage(10);
	public gpuAverageMedium = new NonNegativeRollingAverage(100);
	public gpuAverageSlow = new NonNegativeRollingAverage(1000);
	public fpsAverage = new NonNegativeRollingAverage(30);
	public readonly gpuMemory: GpuMemoryTracker;
	private time = 0;
	private effectStatuses = new Map<string, { sent?: EffectStatus }>();
	private onEffectStatus?: (nodeId: string, status: EffectStatus | null) => void;

	constructor(options: {
		onEffectStatus?: (nodeId: string, status: EffectStatus | null) => void;
		gpuDevice: GPUDevice;
		gpuContext: GPUCanvasContext;
		resolution: {
			width: number;
			height: number;
		};
		enable32bitDataTextures: boolean;
		/** 画像の中間テクスチャ形式。省略時はrgba16float。Canvas・データ用テクスチャには適用しない。 */
		intermediateTextureFormat: IntermediateTextureFormat;
		enableStats: boolean;
		/** 最終出力の黒つぶれを緑、白飛びをマゼンタで表示する。 */
		highlightClipping?: boolean;
		timeFactor?: number;
		fpsLimit: number | null;
		assets: Asset[];
		macros: Macro[];
		automations: GsAutomation[];
		nodes: GsNode[];
		histogramGpuContext: GPUCanvasContext;
		waveformHorizontalGpuContext: GPUCanvasContext;
		waveformVerticalGpuContext: GPUCanvasContext;
	}) {
		this.resolution = options.resolution;
		this.onEffectStatus = options.onEffectStatus;
		this.enableStats = options.enableStats;
		this.highlightClipping = options.highlightClipping ?? false;
		this.timeFactor = options.timeFactor ?? 1;
		this.enable32bitDataTextures = options.enable32bitDataTextures;
		this.intermediateTextureFormat = options.intermediateTextureFormat;
		this.fpsLimit = options.fpsLimit;
		this.gpuDevice = options.gpuDevice;
		this.gpuMemory = new GpuMemoryTracker(this.gpuDevice);
		this.gpuContext = options.gpuContext;
		this.histogramGpuContext = options.histogramGpuContext;
		this.gpuHistogram = new GpuHistogram(
			this.gpuDevice,
			this.histogramGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);
		this.waveformHorizontalGpuContext = options.waveformHorizontalGpuContext;
		this.gpuWaveformHorizontal = new GpuWaveform(
			this.gpuDevice,
			this.waveformHorizontalGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);

		this.gpuWaveformVertical = new GpuWaveform(
			this.gpuDevice,
			options.waveformVerticalGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
			'y',
		);

		this.timingHelper = new TimingHelper(this.gpuDevice);

		this.gpuContext.configure({
			device: this.gpuDevice,
			format: navigator.gpu.getPreferredCanvasFormat(),
			alphaMode: 'premultiplied',
			colorSpace: 'srgb',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.fallbackTexture = this.gpuDevice.createTexture({
			size: [1, 1],
			format: this.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});

		this.fallbackScalarFieldTexture = this.gpuDevice.createTexture({
			size: [1, 1],
			format: this.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
		});

		const sclarPixelData = this.enable32bitDataTextures
			? new Float32Array([0])
			: new Uint16Array([float32ToFloat16Bits(0)]);

		this.gpuDevice.queue.writeTexture(
			{ texture: this.fallbackScalarFieldTexture },
			sclarPixelData,
			{ bytesPerRow: sclarPixelData.byteLength, rowsPerImage: 1 },
			{ width: 1, height: 1 },
		);

		this.defaultVertexShaderModule = this.gpuDevice.createShaderModule({
			code: defaultVertexShaderCode,
		});

		const finalRenderShaderModule = this.gpuDevice.createShaderModule({
			code: finalRenderShaderCode,
		});

		const finalRenderShaderDataDefinitions = makeShaderDataDefinitions(finalRenderShaderCode);

		this.finalRenderSampler = this.gpuDevice.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		this.finalRenderPipeline = this.gpuDevice.createRenderPipeline({
			vertex: {
				module: this.defaultVertexShaderModule,
			},
			fragment: {
				module: finalRenderShaderModule,
				targets: [{
					format: navigator.gpu.getPreferredCanvasFormat(),
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		this.finalRenderUniformValues = makeStructuredView(finalRenderShaderDataDefinitions.uniforms.uniforms);

		this.finalRenderUniformBuffer = this.gpuDevice.createBuffer({
			size: this.finalRenderUniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		this.updateAssets(options.assets);
		this.updateMacros(options.macros);
		this.updateAutomations(options.automations);
		this.updateNodes(options.nodes);
	}

	// 無効なエフェクトは主入力をそのまま公開する。テクスチャの所有権や履歴は元のノードに残す。
	// 描画・入力参照・キャッシュが同じ接続関係を扱うよう、ここで共通して解決する。
	private getOutputNode(node: GsNode, outputPort?: string, visited: GsNode['id'][] = []): { node: GsEffectNode; outputPort: string } | undefined {
		if (visited.includes(node.id)) throw new Error('circular dependency detected');
		const nextVisited = [...visited, node.id];
		if (node.type === 'group') {
			// グループには主入力がないため、無効時は子の出力も公開しない。
			const lastNode = node.nodes.at(-1);
			return !node.isBypass && lastNode != null ? this.getOutputNode(lastNode, outputPort, nextVisited) : undefined;
		}
		if (!node.isBypass) {
			const port = outputPort ?? Object.entries(effectDefinitions[node.effectId].outputs).find(([, def]) => def.primary)?.[0];
			return port == null ? undefined : { node, outputPort: port };
		}
		const primary = Object.entries(effectDefinitions[node.effectId].paramDefs).find(([, def]) => def.primary);
		const input: NodeOutputReference | null = primary ? this.evaledNodeParams.get(node.id)![primary[0]] : null;
		// バイパスでは自身の出力名ではなく、主入力が選択した出力ポートを公開する。
		return input == null ? undefined : this.getOutputNode(this.allNodeIdMap.get(input.nodeId)!, input.outputPort, nextVisited);
	}

	private getOutputTexture(node: GsNode, outputPort: string): GPUTexture | undefined {
		const output = this.getOutputNode(node, outputPort);
		if (output == null) return undefined;
		return this.outDataMapPerNodes.get(output.node.id)![output.outputPort].texture;
	}

	private evalNodeParams(nodes: GsNode[], options: { vars: Record<string, any> }) {
		const scope = {
			WIDTH: this.resolution.width,
			HEIGHT: this.resolution.height,
			...options.vars,
		};

		// Mixin (global) macros
		// TODO: automation support
		// TODO: node support
		const macroScope = {} as Record<string, any>;
		for (const macro of this.macros) {
			macroScope[macro.name] =
				macro.value.type === 'literal'
					? macro.value.value
					: macro.value.expression
						? evaluateExpression(macro.value.expression, scope, macro)
						: genEmptyValue(macro);

			if (macro.type === 'image') {
				macroScope[macro.name] = serializeAsset(
					this.assets.find(a => a.id === macroScope[macro.name]));
			}
		}

		// Mixin (global) automations
		// TODO: 各automationをフレーム数を引数にとる関数として定義する
		const automationScope = {} as Record<string, any>;
		for (const automation of this.automations) {
			automationScope[automation.name] = evalAutomationValue(automation, this.time);
		}

		for (const node of nodes.filter((n): n is GsEffectNode => n.type === 'effect')) {
			const paramDefs = effectDefinitions[node.effectId].paramDefs;

			const evaluatedParams = {} as Record<string, any>;

			const mixedScope = {
				...macroScope,
				...automationScope,
				...scope,
			};

			for (const [key, def] of Object.entries(paramDefs)) {
				// 無効時はバイパス先だけが必要。使わない子の式も評価しない。
				if (node.isBypass && !def.primary) continue;
				evaluatedParams[key] = mapNodeParam(def, node.params[key], [key], (def, param) => {
					if (param.type === 'literal') return param.value;
					if (param.type === 'expression') return param.expression ? evaluateExpression(param.expression, mixedScope, def) : genEmptyValue(def);
					if (param.type === 'automation') {
						const automation = this.automations.find(a => a.id === param.automationId);
						return automation ? evalAutomationValue(automation, this.time) : genEmptyValue(def);
					}
					return param.nodeId == null ? null : { nodeId: param.nodeId, outputPort: param.outputPort };
				});
			}
			this.evaledNodeParams.set(node.id, evaluatedParams);

			for (const { def, param, path } of walkNodeParams(paramDefs, node.params, node.isBypass)) {
				if (!def.canNode || param.type === 'node') continue;
				const v = getEvaluatedParam(evaluatedParams, path);
				const tex = this.effectPerParamConstFieldTextures.get(node.id)![JSON.stringify(path)];
				// TODO: 全てのtypeに対応 & 別関数にする
				const components = def.type === 'color' ? [v?.[0] ?? 0, v?.[1] ?? 0, v?.[2] ?? 0, v?.[3] ?? 0] : def.type === 'vector' ? [v?.[0] ?? 0, v?.[1] ?? 0] : [v ?? 0];
				const pixelData = this.enable32bitDataTextures
					? new Float32Array(components)
					: new Uint16Array(components.map(component => float32ToFloat16Bits(component)));
				this.gpuDevice.queue.writeTexture({ texture: tex }, pixelData,
					{ bytesPerRow: pixelData.byteLength, rowsPerImage: 1 }, { width: 1, height: 1 });
			}
		}

		for (const node of nodes.filter((n): n is GsGroupNode => n.type === 'group')) {
			const groupMacroValues = {} as Record<string, any>;
			// TODO: automation support
			// TODO: node support
			for (const macro of node.macros) {
				groupMacroValues[macro.name] =
					macro.value.type === 'literal'
						? macro.value.value
						: macro.value.expression
							? evaluateExpression(macro.value.expression, scope, macro)
							: genEmptyValue(macro);

				if (macro.type === 'image') {
					groupMacroValues[macro.name] = serializeAsset(
						this.assets.find(a => a.id === groupMacroValues[macro.name]));
				}
			}

			this.evalNodeParams(node.nodes, {
				vars: {
					...scope,
					...groupMacroValues,
				},
			});
		}
	}

	private setEffectStatus(nodeId: string, status: EffectStatus) {
		const state = this.effectStatuses.get(nodeId);
		if (!state) return;
		const previous = state.sent;
		if (previous?.type === status.type && (status.type !== 'error' || (previous.type === 'error' && previous.message === status.message))) return;
		state.sent = status;
		this.onEffectStatus?.(nodeId, status);
	}

	private clearEffectStatus(nodeId: string) {
		if (this.effectStatuses.delete(nodeId)) this.onEffectStatus?.(nodeId, null);
	}

	private evalCacheKey(node: GsNode, visited: GsNode['id'][] = []): string | null {
		if (visited.includes(node.id)) {
			throw new Error('circular dependency detected');
		}

		let key = `node=${node.id};isBypass=${node.isBypass};`;

		if (node.type === 'group' || node.isBypass) {
			// 出力に寄与しない入力やdisableCacheには依存しない。
			// 出力元のIDもキーに含め、同じパラメータの別ノードへの切り替えを検出する。
			const output = this.getOutputNode(node);
			if (output == null) return `${key}output=none;`;
			const outputKey = this.evalCacheKey(output.node, [...visited, node.id]);
			return outputKey == null ? null : `${key}port=${output.outputPort};output=${outputKey};`;
		} else {
			if (effectImplementations[node.effectId].disableCache) { // TODO: 廃止(cacheVersionに一本化)
				return null;
			}
			// 非同期のリソース更新も後続ノードのキャッシュキーに伝播させる。
			key += `cacheVersion=${this.effectInstances.get(node.id)?.cacheVersion ?? 0};`;

			const paramDefs = effectDefinitions[node.effectId].paramDefs;

			const params = this.evaledNodeParams.get(node.id)!;
			// 空配列・空structや要素数の変化もキーに含める。
			key += JSON.stringify(params);
			for (const { def, param, path } of walkNodeParams(paramDefs, node.params)) {
				const v = getEvaluatedParam(params, path);
				key += JSON.stringify([path, param.type]);
				if (def.type === 'player') {
					key += JSON.stringify([path, 'videoFrameVersion', v == null ? 0 : this.videoFrameVersions.get(v) ?? 0]);
					const audio = v == null ? undefined : this.audioSources.get(playerAudioSourceId(v));
					key += JSON.stringify([path, 'audio', audio == null ? null : [audio.generation, audio.revision, audio.endFrame]]);
				}
				if (def.canNode && param.type === 'node' && param.nodeId != null) {
					const targetNode = this.allNodeIdMap.get(param.nodeId);
					if (targetNode == null) throw new Error('Referenced node not found');
					const targetNodeCacheKey = this.evalCacheKey(targetNode, [...visited, node.id]);
					if (targetNodeCacheKey == null) return null;
					key += JSON.stringify([path, targetNodeCacheKey]);
				}
			}
		}

		return key;
	}

	private resolveParams(node: GsEffectNode, params: Record<string, any>): Record<string, any> {
		const resolvedParams: Record<string, any> = {};
		for (const [key, def] of Object.entries(effectDefinitions[node.effectId].paramDefs)) {
			resolvedParams[key] = mapNodeParam(def, node.params[key], [key], (def, param, path) => {
				const v = getEvaluatedParam(params, path);
				if (def.type === 'image') return this.assetTextures.get(v) ?? null;
				if (def.type === 'player') return v == null ? null : {
					videoFrame: this.videoFrames.get(v) ?? null,
					audio: this.audioSources.get(playerAudioSourceId(v)) ?? null,
				};
				if (def.canNode) {
					if (param.type === 'node') {
						if (param.nodeId == null) return this.fallbackScalarFieldTexture;
						return this.getOutputTexture(this.allNodeIdMap.get(param.nodeId)!, param.outputPort) ?? this.fallbackScalarFieldTexture;
					}
					return this.effectPerParamConstFieldTextures.get(node.id)![JSON.stringify(path)];
				}
				return v;
			});
		}
		return resolvedParams;
	}

	private renderNode(node: GsNode, commandEncoder: GPUCommandEncoder, context: { visited: Set<GsNode['id']>; rendered: Set<GsNode['id']>; }): void {
		if (context.visited.has(node.id)) {
			throw new Error('circular dependency detected');
		}
		if (context.rendered.has(node.id)) { // キャッシュが無効だったとしても同じフレーム内に同じノードを複数回レンダリングするのは無駄(というかping-pongするエフェクトなら結果がおかしくなる)なため弾く
			return;
		}

		if (node.type === 'group' || node.isBypass) {
			// 無効中は自身を描画せず、主入力だけを更新する。履歴は保持して再有効化時に再開する。
			const output = this.getOutputNode(node);
			if (output == null) return;
			return this.renderNode(output.node, commandEncoder, {
				visited: new Set([...context.visited, node.id]),
				rendered: context.rendered,
			});
		}

		const key = this.evalCacheKey(node);
		//console.log('Cache key for node', node.id, ':', key);
		const prevKey = this.effectCacheKeys.get(node.id);
		if (key != null && key === prevKey) {
			return;
		}

		const effect = effectImplementations[node.effectId];

		const params = this.evaledNodeParams.get(node.id)!;

		for (const { def, param } of walkNodeParams(effectDefinitions[node.effectId].paramDefs, node.params)) {
			if (!def.canNode || param.type !== 'node' || param.nodeId == null) continue;
			const targetNode = this.allNodeIdMap.get(param.nodeId);
			if (targetNode == null) throw new Error('Referenced node not found');
			this.renderNode(targetNode, commandEncoder, {
				visited: new Set([...context.visited, node.id]),
				rendered: context.rendered,
			});
		}

		const resolvedParams = this.resolveParams(node, params);

		let effectInstance = this.effectInstances.get(node.id);
		if (effectInstance == null) {
			const state: { sent?: EffectStatus } = {};
			this.effectStatuses.set(node.id, state);
			effectInstance = effect.init({
				reportStatus: status => {
					// 初期化中の通知も受け取るが、破棄・再作成後の古い通知は無視する。
					if (this.effectStatuses.get(node.id) !== state) return;
					this.setEffectStatus(node.id, status);
				},
				resolution: { width: this.resolution.width, height: this.resolution.height },
				wgpu: { device: this.gpuDevice, context: this.gpuContext, defaultVertexShaderModule: this.defaultVertexShaderModule, enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat },
				params: resolvedParams,
				fallbackTexture: this.fallbackTexture,
			});
			this.effectInstances.set(node.id, effectInstance);
			// init中に状態が報告されなかった同期エフェクトは、この時点でready。
			if (state.sent == null) this.setEffectStatus(node.id, { type: 'ready' });
		}

		const outDataMap = this.outDataMapPerNodes.get(node.id)!;

		const resolvedOutputDataMap = {} as Record<string, {
			previousFrameTexture: GPUTexture | undefined;
			previousFrameTextureView: GPUTextureView | undefined;
			texture: GPUTexture;
			textureView: GPUTextureView;
		}>;
		for (const [k, v] of Object.entries(outDataMap)) {
			resolvedOutputDataMap[k] = {
				// 現在公開されている出力を、前回の結果として読む
				previousFrameTexture: effect.needsPreviousFrame ? v.texture : undefined,
				previousFrameTextureView: effect.needsPreviousFrame ? v.textureView : undefined,

				// もう1枚へ書く
				texture: effect.needsPreviousFrame ? v.previousFrameTexture! : v.texture,
				textureView: effect.needsPreviousFrame ? v.previousFrameTextureView! : v.textureView,
			};
		}

		effectInstance.render({
			time: this.time / 1000,
			timeDelta: this.timeDelta,
			pointerPosition: this.pointerPosition,
			pointerVector: {
				x: this.pointerPositionPrev.x === -99999 ? 0 : this.pointerPosition.x - this.pointerPositionPrev.x,
				y: this.pointerPositionPrev.y === -99999 ? 0 : this.pointerPosition.y - this.pointerPositionPrev.y,
			},
			params: resolvedParams,
			outputDataMap: resolvedOutputDataMap,
			commandEncoder: commandEncoder,
			createPassEncoderFor: (commandEncoder, view) => {
				const descriptor = {
					colorAttachments: [{
						view: view,
						clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
						loadOp: 'clear',
						storeOp: 'store',
					}],
				} satisfies GPURenderPassDescriptor;
				return this.enableStats ? this.timingHelper.beginRenderPass(commandEncoder, descriptor) : commandEncoder.beginRenderPass(descriptor);
			},
			createPassEncoder: (commandEncoder, descriptor) => {
				return this.enableStats ? this.timingHelper.beginRenderPass(commandEncoder, descriptor) : commandEncoder.beginRenderPass(descriptor);
			},
			createComputePassEncoder: (commandEncoder, descriptor) => {
				return this.enableStats ? this.timingHelper.beginComputePass(commandEncoder, descriptor) : commandEncoder.beginComputePass(descriptor);
			},
		});

		if (effect.needsPreviousFrame) {
			for (const [k, v] of Object.entries(outDataMap)) {
				// 今回書いた結果を後段へ公開
				v.texture = resolvedOutputDataMap[k].texture;
				v.textureView = resolvedOutputDataMap[k].textureView;

				// 今回読んだものを次回の書き込み先として保持
				v.previousFrameTexture = resolvedOutputDataMap[k].previousFrameTexture!;
				v.previousFrameTextureView = resolvedOutputDataMap[k].previousFrameTextureView!;
			}
		}

		context.rendered.add(node.id);
		if (key != null) this.effectCacheKeys.set(node.id, key);
	}

	public render(renderNodeId: string | null | undefined, args: {
		time: number;
		mouseX?: number;
		mouseY?: number;
		frame?: number;
	}) {
		if (renderNodeId == null) return;
		const node = this.allNodeIdMap.get(renderNodeId);
		if (node == null) return;

		const realTimeDelta = args.time - this.latestTimestamp;
		this.timeDelta = realTimeDelta * this.timeFactor;
		this.time += this.timeDelta;

		if (this.lastPointerUpdateTimestamp + 30 < performance.now()) {
			this.pointerPosition = { x: -99999, y: -99999 };
		}

		this.evalNodeParams(this.nodes, {
			vars: {
				TIME: this.time / 1000, // ms to seconds
				TIME_MS: this.time,
			},
		});

		const commandEncoder = this.gpuDevice.createCommandEncoder();

		this.renderNode(node, commandEncoder, {
			visited: new Set<GsNode['id']>(),
			rendered: new Set<GsNode['id']>(),
		});

		//#region nodeのoutをcanvasに描画
		// 末尾が無効でもバイパス先を表示する。出力なしでも描画し、前の画像を残さない。
		const output = this.getOutputNode(node);
		const outputTexture = (output == null ? undefined : this.getOutputTexture(output.node, output.outputPort)) ?? this.fallbackTexture;
		if (this.finalRenderBindGroup == null || this.finalRenderInputTexture !== outputTexture) {
			this.finalRenderInputTexture = outputTexture;
			this.finalRenderBindGroup = this.gpuDevice.createBindGroup({
				layout: this.finalRenderPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 1, resource: { buffer: this.finalRenderUniformBuffer } },
					{ binding: 3, resource: this.finalRenderSampler },
					{ binding: 2, resource: this.finalRenderInputTexture.createView() }, // TODO: cache view
				],
			});
		}

		this.finalRenderUniformValues.set({
			highlightClipping: this.highlightClipping ? 1 : 0,
		});
		this.gpuDevice.queue.writeBuffer(this.finalRenderUniformBuffer, 0, this.finalRenderUniformValues.arrayBuffer);

		const passEncoder = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: this.gpuContext.getCurrentTexture().createView(),
				clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		passEncoder.setPipeline(this.finalRenderPipeline);
		passEncoder.setBindGroup(0, this.finalRenderBindGroup);
		passEncoder.draw(6);
		passEncoder.end();

		this.gpuHistogram.render(commandEncoder, this.finalRenderInputTexture);
		this.gpuWaveformHorizontal.render(commandEncoder, this.finalRenderInputTexture);
		this.gpuWaveformVertical.render(commandEncoder, this.finalRenderInputTexture);

		this.gpuDevice.queue.submit([commandEncoder.finish()]);
		//#endregion

		this.pointerPositionPrev = { ...this.pointerPosition };

		this.latestTimestamp = args.time;

		this.fpsAverage.addSample(1000 / realTimeDelta);

		if (this.enableStats) {
			this.timingHelper.getResult().then(gpuTime => {
				this.gpuAverageFast.addSample(gpuTime / 1000);
				this.gpuAverageMedium.addSample(gpuTime / 1000);
				this.gpuAverageSlow.addSample(gpuTime / 1000);
			});
		}
	}

	// (非workerで)呼び出すときはnewNodesを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateNodes(newNodes: GsNode[]) {
		const oldEffectNodes = getEffectNodes(this.nodes);
		const newEffectNodes = getEffectNodes(newNodes);
		const oldNodeIds = new Set(oldEffectNodes.map(node => node.id));
		const newNodeIds = new Set(newEffectNodes.map(node => node.id));
		const addedNodes = newEffectNodes.filter(node => !oldNodeIds.has(node.id));
		const removedNodes = oldEffectNodes.filter(node => !newNodeIds.has(node.id));

		for (const node of addedNodes) {
			const effect = effectImplementations[node.effectId];
			const outTextureMap = effect.getOut({
				wgpu: { device: this.gpuDevice, enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat },
				resolution: { width: this.resolution.width, height: this.resolution.height },
			});
			let previousFrameTextureMap: Record<string, GPUTexture> = {};
			if (effect.needsPreviousFrame) {
				previousFrameTextureMap = effect.getOut({
					wgpu: { device: this.gpuDevice, enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat },
					resolution: { width: this.resolution.width, height: this.resolution.height },
				});
			}
			const outDataMap = {} as Record<string, {
				texture: GPUTexture;
				textureView: GPUTextureView;
				previousFrameTexture: GPUTexture | undefined;
				previousFrameTextureView: GPUTextureView | undefined;
			}>;
			for (const [k, tex] of Object.entries(outTextureMap)) {
				outDataMap[k] = {
					texture: tex,
					textureView: tex.createView(),
					previousFrameTexture: previousFrameTextureMap[k],
					previousFrameTextureView: previousFrameTextureMap[k]?.createView(),
				};
			}
			this.outDataMapPerNodes.set(node.id, outDataMap);
		}

		// 配列の追加・削除でも末端の定数テクスチャを同期する。同じパスのリソースは再利用する。
		for (const node of newEffectNodes) {
			const textures = this.effectPerParamConstFieldTextures.get(node.id) ?? {};
			const used = new Set<string>();
			for (const { def, path } of walkNodeParams(effectDefinitions[node.effectId].paramDefs, node.params)) {
				if (!def.canNode) continue;
				const key = JSON.stringify(path);
				used.add(key);
				// TODO: 全typeについて定義 & 別関数に切り出し
				const channels = def.type === 'color' ? 'rgba' : def.type === 'vector' ? 'rg' : 'r';
				const format = (channels + (this.enable32bitDataTextures ? '32float' : '16float')) as GPUTextureFormat;
				if (textures[key]?.format === format) continue;
				textures[key]?.destroy();
				textures[key] = this.gpuDevice.createTexture({
					size: [1, 1],
					format,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
				});
			}
			for (const key of Object.keys(textures)) {
				if (used.has(key)) continue;
				textures[key].destroy();
				delete textures[key];
			}
			this.effectPerParamConstFieldTextures.set(node.id, textures);
		}

		for (const node of removedNodes) {
			this.clearEffectStatus(node.id);
			// 出力を破棄するため、リサイズや同じIDでの復元後は再描画が必要。
			this.effectCacheKeys.delete(node.id);
			const outDataMap = this.outDataMapPerNodes.get(node.id);
			if (outDataMap) {
				for (const data of Object.values(outDataMap)) {
					data.texture.destroy();
					data.previousFrameTexture?.destroy();
				}
				this.outDataMapPerNodes.delete(node.id);
			}
			const instance = this.effectInstances.get(node.id);
			if (instance) {
				instance.dispose();
				this.effectInstances.delete(node.id);
			}
			const scalarFieldTextures = this.effectPerParamConstFieldTextures.get(node.id);
			if (scalarFieldTextures) {
				for (const k in scalarFieldTextures) {
					scalarFieldTextures[k].destroy();
				}
				this.effectPerParamConstFieldTextures.delete(node.id);
			}
		}

		this.nodes = newNodes;

		this.allNodeIdMap.clear();
		const indexNodes = (nodes: GsNode[]) => {
			for (const node of nodes) {
				this.allNodeIdMap.set(node.id, node);
				if (node.type === 'group') indexNodes(node.nodes);
			}
		};
		indexNodes(newNodes);
	}

	// (非workerで)呼び出すときはnewAssetsを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateAssets(newAssets: Asset[]) {
		this.assets = newAssets;
		this.bakeAssets();
	}

	// (非workerで)呼び出すときはnewMacrosを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateMacros(newMacros: Macro[]) {
		this.macros = newMacros;
	}

	// (非workerで)呼び出すときはnewAutomationsを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateAutomations(newAutomations: GsAutomation[]) {
		this.automations = newAutomations;
	}

	public attachAudioSource(id: AudioSourceId, port: MessagePort) {
		this.resetAudioSource(id, null);
		const history = new AudioHistory();
		this.audioSources.set(id, history);
		this.audioPorts.set(id, port);
		port.onmessage = (event: MessageEvent<AudioCaptureMessage>) => {
			if (this.audioPorts.get(id) !== port) return;
			const message = event.data;
			if (message.type === 'reset') {
				if (message.generation >= history.generation) history.reset(message.generation);
			} else if (message.type === 'samples') {
				try {
					if (message.frameCount === 1024 && message.buffer.byteLength === 8192
						&& (message.channelCount === 1 || message.channelCount === 2)
						&& Number.isFinite(message.sampleRate) && message.sampleRate >= 8000 && message.sampleRate <= 192000
						&& Number.isSafeInteger(message.startFrame) && message.startFrame >= 0) history.append(message);
				} finally {
					port.postMessage({ type: 'recycle', buffer: message.buffer }, [message.buffer]);
				}
			}
		};
	}

	public resetAudioSource(id: AudioSourceId, generation: number | null) {
		const history = this.audioSources.get(id);
		if (generation == null) {
			history?.reset();
			this.audioPorts.get(id)?.close();
			this.audioPorts.delete(id);
			this.audioSources.delete(id);
		} else if (history && generation >= history.generation) {
			history.reset(generation);
		}
	}

	public updateVideoFrame(playerId: Player['id'], videoFrame: VideoFrame | null) {
		// 同じtimestampでも別のフレームとして扱う。削除・再追加でも更新番号を戻さない。
		this.videoFrameVersions.set(playerId, (this.videoFrameVersions.get(playerId) ?? 0) + 1);
		this.videoFrames.get(playerId)?.close();
		if (videoFrame) {
			this.videoFrames.set(playerId, videoFrame);
		} else {
			this.videoFrames.delete(playerId);
		}
	}

	public async bakeAssets() {
		// 同じAsset IDでもテクスチャを作り直すため、ネスト内の画像参照も再解決する。
		this.effectCacheKeys.clear();
		for (const [k, v] of this.assetTextures.entries()) {
			v.destroy();
			this.assetTextures.delete(k);
		}

		for (const asset of this.assets) {
			if (asset.fileDataType.startsWith('image/') && asset.data != null) {
				const tex = createTextureFromSource(this.gpuDevice, {
					data: asset.data,
					width: asset.width,
					height: asset.height,
				});
				this.assetTextures.set(asset.id, tex);
			}
		}
	}

	public updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.pointerPosition = newPointerPosition;
		this.lastPointerUpdateTimestamp = performance.now();
	}

	private fpsLimit: number | null;
	private currentRafId: number | null = null;

	public changeFpsLimit(newFpsLimit: number | null) {
		this.fpsLimit = newFpsLimit;
		this.stopRenderLoop();
		this.startRenderLoop();
	}

	public setHighlightClipping(enabled: boolean) {
		this.highlightClipping = enabled;
	}

	public setTimeFactor(value: number) {
		this.timeFactor = value;
	}

	public startRenderLoop() {
		this.stopRenderLoop();
		let then = 0;
		const interval = 1000 / (this.fpsLimit ?? 999);

		const renderLoop = (timeStamp: number) => {
			this.currentRafId = requestAnimationFrame(renderLoop);

			if (this.fpsLimit != null) {
				const delta = timeStamp - then;
				if (delta <= interval) return;
				then = timeStamp - (delta % interval);
			}

			this.render(this.nodes.at(-1)?.id, {
				time: timeStamp,
			});
		};

		this.currentRafId = requestAnimationFrame(renderLoop);
	}

	public stopRenderLoop() {
		if (this.currentRafId != null) {
			cancelAnimationFrame(this.currentRafId);
			this.currentRafId = null;
		}
	}

	// TODO: もっとスマートなリソース更新方法を考える
	public resize(resolution: {
		width: number;
		height: number;
	}) {
		this.stopRenderLoop();
		this.resolution = resolution;

		for (const id of this.effectStatuses.keys()) this.clearEffectStatus(id);
		for (const instance of this.effectInstances.values()) {
			instance?.dispose();
		}
		this.effectInstances.clear();

		for (const outDataMap of this.outDataMapPerNodes.values()) {
			for (const outData of Object.values(outDataMap)) {
				outData.texture.destroy();
				if (outData.previousFrameTexture) {
					outData.previousFrameTexture.destroy();
				}
			}
		}
		this.outDataMapPerNodes.clear();

		const currentNodes = this.nodes;
		this.updateNodes([]);
		this.updateNodes(currentNodes);

		this.startRenderLoop();
	}

	public destroy() {
		for (const id of this.audioPorts.keys()) this.resetAudioSource(id, null);
		for (const frame of this.videoFrames.values()) frame.close();
		this.videoFrames.clear();
		this.videoFrameVersions.clear();
		this.gpuHistogram.dispose();
		this.gpuWaveformHorizontal.dispose();
		this.gpuWaveformVertical.dispose();

		for (const id of this.effectStatuses.keys()) this.clearEffectStatus(id);
		for (const instance of this.effectInstances.values()) {
			instance?.dispose();
		}
		this.effectInstances.clear();

		for (const outDataMap of this.outDataMapPerNodes.values()) {
			for (const outData of Object.values(outDataMap)) {
				outData.texture.destroy();
				if (outData.previousFrameTexture) {
					outData.previousFrameTexture.destroy();
				}
			}
		}
		this.outDataMapPerNodes.clear();

		this.gpuDevice?.destroy();
	}
}
