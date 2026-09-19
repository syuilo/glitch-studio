import { createTextureFromSource, makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import * as AiScript from '@syuilo/aiscript';
import { evalAutomationValue, genEmptyValue } from '@glitch/shared/utility/misc.ts';
import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { playerAudioSourceId } from '@glitch/shared/audio.ts';
import { AudioHistory } from '@glitch/shared/audio-history.ts';
import { float32ToFloat16Bits } from '@glitch/shared/utility/float32ToFloat16Bits.ts';
import { effectImplementations } from '@glitch/shared/effect-implementations.js';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
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
import type { Asset, GsAutomation, GsEffectNode, GsGlobalInNode, GsNode, Player, NodeOutputReference, EffectParamDef, Timeline, VisualModule, VisualModuleParamValues } from '@glitch/shared/types.ts';
import type { EffectInstance, IntermediateTextureFormat } from '@glitch/shared/effect-implementation.js';

const aisParser = new AiScript.Parser();

// 評価ごとにスコープを分離し、別モジュールや外側の式にPARAMが漏れないようにする。
function evaluateExpression(expression: string, scope: Record<string, any>, paramDefForFallback: Omit<EffectParamDef, 'default'>, getParam?: (name: string) => any): any {
	try {
		const constants = Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, AiScript.utils.jsToVal(value)]));
		if (getParam != null) {
			const readParam = (args: AiScript.values.Value[]) => {
				if (args.length !== 1 || args[0]?.type !== 'str') throw new Error('PARAM requires a parameter name');
				return AiScript.utils.jsToVal(getParam(args[0].value));
			};
			constants.PARAM = AiScript.values.FN_NATIVE(readParam, readParam);
		} else {
			// 同名のAutomationがあっても外部パラメータの式にPARAMを公開しない。
			delete constants.PARAM;
		}
		const interpreter = new AiScript.Interpreter(constants);
		const value = interpreter.execSync(aisParser.parse(expression));
		return value === undefined ? null : AiScript.utils.valToJs(value);
	} catch {
		return genEmptyValue(paramDefForFallback);
	}
}

type VisualModuleRenderContext = {
	//globalTime: number; // タイムラインの再生位置を示すが、使わなそう
	localTime: number;
	localTimeDelta: number;
	layerDurationMs?: number;
	paramTextures?: ReadonlyMap<string, GPUTexture>;
	pointerPosition: { x: number; y: number };
	pointerPositionPrev: { x: number; y: number };
	paramValues: VisualModuleParamValues;
};

class VisualModuleRenderer {
	private gpuDevice: GPUDevice;
	private gpuContext: GPUCanvasContext;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private resolution: { width: number; height: number; };
	private nodes: GsNode[] = [];
	private paramDefs: VisualModule['paramDefs'];
	private paramValues = new Map<string, any>();
	private paramTextures: ReadonlyMap<string, GPUTexture> = new Map();
	private paramConstTextures = new Map<string, GPUTexture>();
	private preparedContext: VisualModuleRenderContext | null = null;
	private statusWaiters = new Set<() => void>();
	private destroyed = false;
	private allNodeIdMap: Map<GsNode['id'], GsNode> = new Map(); // モジュール内のノードをIDで解決する。
	private evaledNodeParams: Map<GsNode['id'], Record<string, any>> = new Map();
	private effectInstances: Map<GsEffectNode['id'], EffectInstance | null> = new Map();
	private effectPerParamConstFieldTextures: Map<GsEffectNode['id'], Record<string, GPUTexture>> = new Map();
	private outDataMapPerNodes: Map<GsEffectNode['id'], Record<string, {
		texture: GPUTexture;
		textureView: GPUTextureView;
		previousFrameTexture?: GPUTexture;
		previousFrameTextureView?: GPUTextureView;
	}>> = new Map();
	private effectCacheKeys: Map<GsEffectNode['id'], string> = new Map();
	private lazyOutputs = new Map<string, Record<string, () => void>>();
	private usedOutputPorts = new Map<string, Set<string>>();
	private effectStatuses = new Map<string, { sent?: EffectStatus }>();
	private onEffectStatus?: (nodeId: string, status: EffectStatus | null) => void;
	private assets: Asset[];
	private automations: GsAutomation[];
	private enable32bitDataTextures = false;
	private readonly intermediateTextureFormat: IntermediateTextureFormat;
	private videoFrames: Map<string, VideoFrame>;
	private videoFrameVersions: Map<string, number>;
	private fallbackScalarFieldTexture: GPUTexture;
	private assetTextures: Map<string, GPUTexture>;
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private timingHelper: TimingHelper;
	private enableStats = true;
	private renderNodeId: GsNode['id'] | null = null;
	public lastRenderedLocalTime: number | null = null;

	constructor(options: {
		onEffectStatus?: (nodeId: string, status: EffectStatus | null) => void;
		enableStats: boolean;
		timingHelper: TimingHelper;
		gpuDevice: GPUDevice;
		gpuContext: GPUCanvasContext;
		defaultVertexShaderModule: GPUShaderModule;
		fallbackTexture: GPUTexture;
		resolution: { width: number; height: number; };
		enable32bitDataTextures: boolean;
		intermediateTextureFormat: IntermediateTextureFormat;
		videoFrames: Map<string, VideoFrame>;
		videoFrameVersions: Map<string, number>;
		fallbackScalarFieldTexture: GPUTexture;
		assets: Asset[];
		automations: GsAutomation[];
		visualModule: VisualModule;
		assetTextures: Map<string, GPUTexture>;
		audioSources: Map<AudioSourceId, AudioHistory>;
	}) {
		this.gpuDevice = options.gpuDevice;
		this.gpuContext = options.gpuContext;
		this.defaultVertexShaderModule = options.defaultVertexShaderModule;
		this.fallbackTexture = options.fallbackTexture;
		this.paramDefs = options.visualModule.paramDefs;
		this.onEffectStatus = options.onEffectStatus;
		this.enableStats = options.enableStats;
		this.resolution = options.resolution;
		this.enable32bitDataTextures = options.enable32bitDataTextures;
		this.intermediateTextureFormat = options.intermediateTextureFormat;
		this.videoFrames = options.videoFrames;
		this.videoFrameVersions = options.videoFrameVersions;
		this.fallbackScalarFieldTexture = options.fallbackScalarFieldTexture;
		this.assets = options.assets;

		this.automations = options.automations;
		this.assetTextures = options.assetTextures;
		this.audioSources = options.audioSources;
		this.timingHelper = options.timingHelper;
		this.updateVisualModule(options.visualModule);
	}

	public updateVisualModule(visualModule: VisualModule) {
		const primaryInputs = visualModule.paramDefs.filter(def => def.isPrimaryInput);
		if (primaryInputs.length > 1 || primaryInputs.some(def => !def.canNode || def.type !== 'color')) {
			throw new Error('The primary input must be a single node-capable color parameter');
		}
		if (new Set(visualModule.paramDefs.map(def => def.id)).size !== visualModule.paramDefs.length
			|| new Set(visualModule.paramDefs.map(def => def.name)).size !== visualModule.paramDefs.length) {
			throw new Error('Visual module parameter IDs and names must be unique');
		}
		this.paramDefs = visualModule.paramDefs;
		this.preparedContext = null;
		this.paramValues.clear();
		this.paramTextures = new Map();
		for (const texture of this.paramConstTextures.values()) texture.destroy();
		this.paramConstTextures.clear();
		this.effectCacheKeys.clear();
		this.updateNodes(visualModule.nodes);
	}

	private evaluateParams(context: VisualModuleRenderContext, scope: Record<string, any>) {
		this.paramValues.clear();
		this.paramTextures = context.paramTextures ?? new Map();
		for (const [id] of this.paramTextures) {
			if (!this.paramDefs.some(def => def.id === id && def.canNode)) throw new Error(`Invalid texture parameter: ${id}`);
		}
		for (const def of this.paramDefs) {
			const value = context.paramValues[def.id];
			// RPC経由の値も検査する。外部にはnode/macroによる参照を許可しない。
			if (value != null && value.type !== 'literal' && value.type !== 'expression' && value.type !== 'automation') {
				throw new Error(`Invalid external parameter value: ${def.id}`);
			}
			if (this.paramTextures.has(def.id)) continue;
			const fallbackDef = { ...def.typeOptions, type: def.type, label: def.label };
			let evaluated = deepClone(def.defaultValue); // 参照が共有されないように切る
			if (value?.type === 'literal') evaluated = value.value;
			if (value?.type === 'expression') evaluated = evaluateExpression(value.expression, scope, fallbackDef);
			if (value?.type === 'automation') {
				const automation = this.automations.find(automation => automation.id === value.automationId);
				evaluated = automation == null ? deepClone(def.defaultValue) : evalAutomationValue(automation, context.localTime);
			}
			this.paramValues.set(def.id, evaluated);
		}
	}

	private readParam(name: string): any {
		const def = this.paramDefs.find(def => def.name === name);
		if (def == null) throw new Error(`Unknown parameter: ${name}`);
		if (this.paramTextures.has(def.id)) throw new Error(`Texture parameter cannot be read by PARAM: ${name}`);
		return this.paramValues.get(def.id);
	}

	private getParamTexture(paramId: string): GPUTexture | undefined {
		const def = this.paramDefs.find(def => def.id === paramId);
		if (def == null || !def.canNode) return undefined;
		const input = this.paramTextures.get(paramId);
		if (input != null) return input; // 呼び出し元のテクスチャは所有・破棄しない。
		const value = this.paramValues.get(paramId);
		if (def.type === 'image') return this.assetTextures.get(value) ?? this.fallbackTexture;
		let components: number[];
		if (def.type === 'color') {
			const alpha = value?.[3] ?? 0;
			// 定数色を画像として出力する境界だけでpremultiplyする。macro/PARAMの値は変更しない。
			components = [(value?.[0] ?? 0) * alpha, (value?.[1] ?? 0) * alpha, (value?.[2] ?? 0) * alpha, alpha];
		} else if (['vector', 'xy', 'wh', 'range2'].includes(def.type)) {
			components = [value?.[0] ?? 0, value?.[1] ?? 0];
		} else if (def.type === 'signal') {
			components = [Number(value?.[0] ?? 0), Number(value?.[1] ?? 0), Number(value?.[2] ?? 0), 0];
		} else if (['number', 'angle', 'range', 'seed', 'time', 'bool'].includes(def.type)) {
			components = [Number(value ?? 0)];
		} else {
			throw new Error(`Parameter type cannot be converted to a texture: ${def.type}`);
		}
		let texture = this.paramConstTextures.get(paramId);
		if (texture == null) {
			const channels = components.length === 4 ? 'rgba' : components.length === 2 ? 'rg' : 'r';
			texture = this.gpuDevice.createTexture({
				size: [1, 1],
				format: `${channels}${this.enable32bitDataTextures ? '32float' : '16float'}` as GPUTextureFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			this.paramConstTextures.set(paramId, texture);
		}
		const data = this.enable32bitDataTextures ? new Float32Array(components) : new Uint16Array(components.map(float32ToFloat16Bits));
		this.gpuDevice.queue.writeTexture({ texture }, data, { bytesPerRow: data.byteLength }, [1, 1]);
		return texture;
	}

	public updateAutomations(automations: GsAutomation[]) {
		this.automations = automations;
		this.preparedContext = null;
	}

	private evalNodeParams(nodes: GsNode[], context: VisualModuleRenderContext) {
		const scope = {
			WIDTH: this.resolution.width,
			HEIGHT: this.resolution.height,
			TIME: context.localTime / 1000, // ms to seconds
			TIME_MS: context.localTime,
			PROGRESS: context.layerDurationMs != null && context.layerDurationMs > 0 ? context.localTime / context.layerDurationMs : 0,
		};

		// Mixin (global) automations
		// TODO: 各automationをフレーム数を引数にとる関数として定義する
		const automationScope = {} as Record<string, any>;
		for (const automation of this.automations) {
			automationScope[automation.name] = evalAutomationValue(automation, context.localTime);
		}

		this.evaluateParams(context, { ...automationScope, ...scope });

		for (const node of nodes.filter((n): n is GsEffectNode => n.type === 'effect')) {
			const paramDefs = effectDefinitions[node.effectId].paramDefs;

			const evaluatedParams = {} as Record<string, any>;

			const mixedScope = {
				...automationScope,
				...scope,
			};

			for (const [key, def] of Object.entries(paramDefs)) {
				// 無効時はバイパス先だけが必要。使わない子の式も評価しない。
				if (node.isBypass && !def.primary) continue;
				evaluatedParams[key] = mapNodeParam(def, node.params[key], [key], (def, param) => {
					if (param.type === 'literal') return param.value;
					if (param.type === 'expression') return param.expression ? evaluateExpression(param.expression, mixedScope, def, name => this.readParam(name)) : genEmptyValue(def);
					if (param.type === 'macro') {
						if (!this.paramValues.has(param.macroId) || this.paramTextures.has(param.macroId)) return genEmptyValue(def);
						return this.paramValues.get(param.macroId);
					}
					if (param.type === 'automation') {
						const automation = this.automations.find(a => a.id === param.automationId);
						return automation ? evalAutomationValue(automation, context.localTime) : genEmptyValue(def);
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
	}

	private setEffectStatus(nodeId: string, status: EffectStatus) {
		const state = this.effectStatuses.get(nodeId);
		if (!state) return;
		const previous = state.sent;
		if (previous?.type === status.type && (status.type !== 'error' || (previous.type === 'error' && previous.message === status.message))) return;
		state.sent = status;
		for (const notify of this.statusWaiters) notify();
		this.onEffectStatus?.(nodeId, status);
	}

	private clearEffectStatus(nodeId: string) {
		if (this.effectStatuses.delete(nodeId)) this.onEffectStatus?.(nodeId, null);
	}

	private evalCacheKey(node: GsNode, visited: GsNode['id'][] = []): string | null {
		if (visited.includes(node.id)) {
			throw new Error('circular dependency detected');
		}

		if (node.type === 'globalIn' || node.type === 'globalOut') return null;

		let key = `node=${node.id};isBypass=${node.isBypass};`;

		if (node.isBypass) {
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
			// 出力の利用開始・停止でも、依存先を含めキャッシュを更新する。
			if (this.lazyOutputs.has(node.id)) key += `ports=${JSON.stringify([...(this.usedOutputPorts.get(node.id) ?? [])].sort())};`;

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

	private prepareOutputPorts(node: GsNode): void {
		this.usedOutputPorts.clear();
		const visit = (target: GsNode, port?: string) => {
			const output = this.getOutputNode(target, port);
			if (output == null) return;
			if (output.node.type === 'globalIn') return;
			const ports = this.usedOutputPorts.get(output.node.id);
			if (ports != null) {
				ports.add(output.outputPort);
				return;
			}
			this.usedOutputPorts.set(output.node.id, new Set([output.outputPort]));
			for (const { def, param } of walkNodeParams(effectDefinitions[output.node.effectId].paramDefs, output.node.params)) {
				if (!def.canNode || param.type !== 'node' || param.nodeId == null) continue;
				const source = this.allNodeIdMap.get(param.nodeId);
				if (source != null) visit(source, param.outputPort ?? undefined);
			}
		};
		visit(node);
		// 描画順によらず必要なポートを先に集め、同じノードは1回の描画で全需要を満たす。
		for (const [id, factories] of this.lazyOutputs) {
			const outputs = this.outDataMapPerNodes.get(id)!;
			for (const [port, allocate] of Object.entries(factories)) {
				if (this.usedOutputPorts.get(id)?.has(port)) {
					if (outputs[port] == null) allocate();
				} else if (outputs[port] != null) {
					outputs[port].texture.destroy();
					outputs[port].previousFrameTexture?.destroy();
					delete outputs[port];
					// 後で再確保した際に古い描画済みキャッシュを使わない。
					this.effectCacheKeys.delete(id);
				}
			}
		}
	}

	// (非workerで)呼び出すときはnewNodesを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateNodes(newNodes: GsNode[]) {
		const oldEffectNodes = this.nodes.filter(node => node.type === 'effect');
		const newEffectNodes = newNodes.filter(node => node.type === 'effect');
		const oldNodeIds = new Set(oldEffectNodes.map(node => node.id));
		const newNodeIds = new Set(newEffectNodes.map(node => node.id));
		const addedNodes = newEffectNodes.filter(node => !oldNodeIds.has(node.id));
		const removedNodes = oldEffectNodes.filter(node => !newNodeIds.has(node.id));

		for (const node of addedNodes) {
			const effect = effectImplementations[node.effectId];
			const allocationArgs = {
				wgpu: { device: this.gpuDevice, enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat },
				resolution: { width: this.resolution.width, height: this.resolution.height },
			};
			const outDataMap = {} as Record<string, {
				texture: GPUTexture;
				textureView: GPUTextureView;
				previousFrameTexture: GPUTexture | undefined;
				previousFrameTextureView: GPUTextureView | undefined;
			}>;
			const lazy: Record<string, () => void> = {};
			for (const [k, createTexture] of Object.entries(effect.outputTextureFactories)) {
				const allocate = () => {
					const tex = createTexture(allocationArgs);
					const previousTexture = effect.needsPreviousFrame ? createTexture(allocationArgs) : undefined;
					outDataMap[k] = {
						texture: tex,
						textureView: tex.createView(),
						previousFrameTexture: previousTexture,
						previousFrameTextureView: previousTexture?.createView(),
					};
				};
				if (effectDefinitions[node.effectId].outputs[k].canLazyAllocation === true) lazy[k] = allocate;
				else allocate();
			}
			if (Object.keys(lazy).length > 0) this.lazyOutputs.set(node.id, lazy);
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
			this.lazyOutputs.delete(node.id);
			this.usedOutputPorts.delete(node.id);
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
			}
		};
		indexNodes(newNodes);

		this.renderNodeId = this.nodes.find(node => node.type === 'globalOut')?.id ?? null;
	}

	public updateAssets(assets: Asset[]) {
		this.assets = assets;
		// 同じAsset IDでもテクスチャを作り直すため、ネスト内の画像参照も再解決する。
		this.effectCacheKeys.clear();
	}

	// 無効なエフェクトは主入力をそのまま公開する。テクスチャの所有権や履歴は元のノードに残す。
	// 描画・入力参照・キャッシュが同じ接続関係を扱うよう、ここで共通して解決する。
	private getOutputNode(node: GsNode, outputPort?: string, visited: GsNode['id'][] = []): { node: GsEffectNode | GsGlobalInNode; outputPort: string } | undefined {
		if (visited.includes(node.id)) throw new Error('circular dependency detected');
		const nextVisited = [...visited, node.id];
		if (node.type === 'globalIn') return { node, outputPort: 'output' };
		if (node.type === 'globalOut') {
			const source = node.input.nodeId == null ? undefined : this.allNodeIdMap.get(node.input.nodeId);
			return source == null ? undefined : this.getOutputNode(source, node.input.outputPort ?? undefined, nextVisited);
		}
		if (!node.isBypass) {
			const port = outputPort ?? Object.entries(effectDefinitions[node.effectId].outputs).find(([, def]) => def.primary)?.[0];
			return port == null || effectDefinitions[node.effectId].outputs[port] == null ? undefined : { node, outputPort: port };
		}
		const primary = Object.entries(effectDefinitions[node.effectId].paramDefs).find(([, def]) => def.primary);
		const input: NodeOutputReference | null = primary ? this.evaledNodeParams.get(node.id)![primary[0]] : null;
		// バイパスでは自身の出力名ではなく、主入力が選択した出力ポートを公開する。
		const source = input == null ? undefined : this.allNodeIdMap.get(input.nodeId);
		return source == null ? undefined : this.getOutputNode(source, input!.outputPort, nextVisited);
	}

	private getOutputTexture(node: GsNode, outputPort: string): GPUTexture | undefined {
		const output = this.getOutputNode(node, outputPort);
		if (output == null) return undefined;
		if (output.node.type === 'globalIn') return this.getParamTexture(output.node.paramId);
		return this.outDataMapPerNodes.get(output.node.id)?.[output.outputPort]?.texture;
	}

	private renderNode(node: GsNode, commandEncoder: GPUCommandEncoder, context: VisualModuleRenderContext & {
		visited: Set<GsNode['id']>;
		rendered: Set<GsNode['id']>;
	}): void {
		if (node.type === 'globalIn') return;
		if (node.type === 'globalOut') {
			const output = this.getOutputNode(node);
			if (output != null) this.renderNode(output.node, commandEncoder, context);
			return;
		}
		if (context.visited.has(node.id)) {
			throw new Error('circular dependency detected');
		}
		if (context.rendered.has(node.id)) { // キャッシュが無効だったとしても同じフレーム内に同じノードを複数回レンダリングするのは無駄(というかping-pongするエフェクトなら結果がおかしくなる)なため弾く
			return;
		}

		if (node.isBypass) {
			// 無効中は自身を描画せず、主入力だけを更新する。履歴は保持して再有効化時に再開する。
			const output = this.getOutputNode(node);
			if (output == null) return;
			return this.renderNode(output.node, commandEncoder, {
				...context,
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
				...context,
				visited: new Set([...context.visited, node.id]),
				rendered: context.rendered,
			});
		}

		const resolvedParams = this.resolveParams(node, params);

		const effectInstance = this.initializeEffect(node, resolvedParams);

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
			time: context.localTime / 1000,
			timeDelta: context.localTimeDelta,
			pointerPosition: context.pointerPosition,
			pointerVector: {
				x: context.pointerPositionPrev.x === -99999 ? 0 : context.pointerPosition.x - context.pointerPositionPrev.x,
				y: context.pointerPositionPrev.y === -99999 ? 0 : context.pointerPosition.y - context.pointerPositionPrev.y,
			},
			params: resolvedParams,
			outputDataMap: resolvedOutputDataMap,
			usedOutputPorts: this.usedOutputPorts.get(node.id),
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

	private initializeEffect(node: GsEffectNode, params: Record<string, any>): EffectInstance {
		const existing = this.effectInstances.get(node.id);
		if (existing != null) return existing;
		const state: { sent?: EffectStatus } = {};
		this.effectStatuses.set(node.id, state);
		const instance = effectImplementations[node.effectId].init({
			reportStatus: status => {
				// 破棄・再作成後の古い通知は無視する。
				if (this.effectStatuses.get(node.id) === state) this.setEffectStatus(node.id, status);
			},
			resolution: { ...this.resolution },
			wgpu: { device: this.gpuDevice, context: this.gpuContext, defaultVertexShaderModule: this.defaultVertexShaderModule, enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat },
			params,
			fallbackTexture: this.fallbackTexture,
		});
		this.effectInstances.set(node.id, instance);
		if (state.sent == null) this.setEffectStatus(node.id, { type: 'ready' });
		return instance;
	}

	// 描画せずに初期化・パラメータ変更の準備を行い、履歴を余分に進めない。
	public async prepare(context: VisualModuleRenderContext, signal: AbortSignal): Promise<void> {
		const node = this.renderNodeId == null ? undefined : this.allNodeIdMap.get(this.renderNodeId);
		if (node == null) return;
		this.evalNodeParams(this.nodes, context);
		this.prepareOutputPorts(node);
		const prepared = new Set<string>();
		const visit = (target: GsNode, visited: string[], port?: string) => {
			if (visited.includes(target.id)) throw new Error('circular dependency detected');
			if (prepared.has(target.id)) return;
			const output = this.getOutputNode(target, port);
			if (output == null || output.node.type === 'globalIn') return;
			const effectNode = output.node;
			if (prepared.has(effectNode.id)) return;
			for (const { def, param } of walkNodeParams(effectDefinitions[effectNode.effectId].paramDefs, effectNode.params)) {
				if (!def.canNode || param.type !== 'node' || param.nodeId == null) continue;
				const source = this.allNodeIdMap.get(param.nodeId);
				if (source == null) throw new Error('Referenced node not found');
				visit(source, [...visited, target.id, effectNode.id], param.outputPort ?? undefined);
			}
			const params = this.resolveParams(effectNode, this.evaledNodeParams.get(effectNode.id)!);
			this.initializeEffect(effectNode, params).prepare?.(params);
			prepared.add(effectNode.id);
		};
		visit(node, []);
		await new Promise<void>((resolve, reject) => {
			const check = () => {
				const states = [...prepared].map(id => this.effectStatuses.get(id)!);
				const error = states.find(state => state.sent?.type === 'error')?.sent;
				if (!signal.aborted && !this.destroyed && error == null && states.some(state => state.sent?.type === 'loading')) return;
				this.statusWaiters.delete(check);
				signal.removeEventListener('abort', check);
				if (!signal.aborted && !this.destroyed && error?.type === 'error') reject(new Error(error.message));
				else resolve();
			};
			this.statusWaiters.add(check);
			signal.addEventListener('abort', check);
			check();
		});
		if (!signal.aborted && !this.destroyed) this.preparedContext = context;
	}

	public render(context: VisualModuleRenderContext, commandEncoder: GPUCommandEncoder): GPUTexture | undefined {
		if (this.renderNodeId == null) return;
		const node = this.allNodeIdMap.get(this.renderNodeId);
		if (node == null) return;

		// 準備時と同じ評価結果を使い、式の再評価によるリソースの再読み込みを防ぐ。
		if (this.preparedContext !== context) this.evalNodeParams(this.nodes, context);
		this.preparedContext = null;

		this.prepareOutputPorts(node);

		this.renderNode(node, commandEncoder, {
			...context,
			visited: new Set<GsNode['id']>(),
			rendered: new Set<GsNode['id']>(),
		});

		const output = this.getOutputNode(node);
		const outputTexture = output == null ? undefined : this.getOutputTexture(output.node, output.outputPort);
		this.lastRenderedLocalTime = context.localTime;

		return outputTexture ?? (node.type === 'globalOut' ? undefined : this.fallbackTexture);
	}

	// TODO: もっとスマートなリソース更新方法を考える
	public resize(resolution: {
		width: number;
		height: number;
	}) {
		this.resolution = resolution;
		this.lastRenderedLocalTime = null;
		this.preparedContext = null;

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
		this.lazyOutputs.clear();
		this.usedOutputPorts.clear();

		const currentNodes = this.nodes;
		this.updateNodes([]);
		this.updateNodes(currentNodes);
	}

	public destroy() {
		this.destroyed = true;
		for (const texture of this.paramConstTextures.values()) texture.destroy();
		this.paramConstTextures.clear();
		for (const notify of this.statusWaiters) notify();
		for (const textures of this.effectPerParamConstFieldTextures.values()) {
			for (const texture of Object.values(textures)) texture.destroy();
		}
		this.effectPerParamConstFieldTextures.clear();
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
		this.lazyOutputs.clear();
		this.usedOutputPorts.clear();
	}
}

export class MainRenderer {
	private timelineRenderVersion = 0;
	private timelineRenderAbort: AbortController | null = null;
	private onEffectStatus?: (nodeId: string, status: EffectStatus | null) => void;
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private resolution: { width: number; height: number; };
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private fallbackScalarFieldTexture: GPUTexture;
	private enableStats = true;
	private highlightClipping = false;
	private timeFactor = 1;
	private liveVisualModuleId: VisualModule['id'] | null = null;
	private liveParamValues: VisualModuleParamValues = {};
	private liveVisualModuleRenderer: VisualModuleRenderer | null = null;
	private timeline: Timeline = [];
	private assets: Asset[] = [];

	private automations: GsAutomation[] = [];
	private visualModules: VisualModule[] = [];
	private assetTextures: Map<string, GPUTexture> = new Map();
	private videoFrames: Map<Player['id'], VideoFrame> = new Map();
	private videoFrameVersions: Map<Player['id'], number> = new Map();
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private audioPorts = new Map<AudioSourceId, MessagePort>();
	private perLayerVisualModuleRenderers: Map<Timeline[number]['id'], VisualModuleRenderer> = new Map();
	private timingHelper: TimingHelper;
	private finalRenderSampler: GPUSampler;
	private finalRenderPipeline: GPURenderPipeline;
	private finalRenderUniformValues: ReturnType<typeof makeStructuredView>;
	private finalRenderUniformBuffer: GPUBuffer;
	private finalRenderBindGroup: GPUBindGroup | null = null;
	private latestRenderedToCanasTexture: GPUTexture | null = null;
	private enable32bitDataTextures = false;
	private readonly intermediateTextureFormat: IntermediateTextureFormat;
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
	private liveModeFpsLimit: number | null;
	private currentLiveModeRafId: number | null = null;

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
		visualModules?: VisualModule[];
		timeline?: Timeline;
		assets: Asset[];
		automations: GsAutomation[];
		histogramGpuContext: GPUCanvasContext;
		waveformHorizontalGpuContext: GPUCanvasContext;
		waveformVerticalGpuContext: GPUCanvasContext;
	}) {
		this.resolution = options.resolution;
		this.onEffectStatus = options.onEffectStatus;
		this.visualModules = options.visualModules ?? [];
		this.timeline = options.timeline ?? [];
		this.enableStats = options.enableStats;
		this.highlightClipping = options.highlightClipping ?? false;
		this.timeFactor = options.timeFactor ?? 1;
		this.enable32bitDataTextures = options.enable32bitDataTextures;
		this.intermediateTextureFormat = options.intermediateTextureFormat;
		this.liveModeFpsLimit = options.fpsLimit;
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

		this.updateAutomations(options.automations);
	}

	// (非workerで)呼び出すときはnewAssetsを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateAssets(newAssets: Asset[]) {
		this.clearTimelineRenderers();
		this.assets = newAssets;
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
		for (const visualModuleRenderer of this.perLayerVisualModuleRenderers.values()) {
			visualModuleRenderer.updateAssets(this.assets);
		}
		this.liveVisualModuleRenderer?.updateAssets(this.assets);
	}

	// (非workerで)呼び出すときはnewAutomationsを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateAutomations(newAutomations: GsAutomation[]) {
		this.clearTimelineRenderers();
		this.automations = newAutomations;
		this.liveVisualModuleRenderer?.updateAutomations(newAutomations);
	}

	public updateVisualModules(newVisualModules: VisualModule[]) {
		this.clearTimelineRenderers();
		this.visualModules = newVisualModules;
		if (this.liveVisualModuleRenderer != null) {
			const visualModule = this.visualModules.find(visualModule => visualModule.id === this.liveVisualModuleId);
			if (visualModule == null) this.stopRenderLoop();
			else this.liveVisualModuleRenderer.updateVisualModule(visualModule);
		}
	}

	public updateTimeline(newTimeline: Timeline) {
		this.clearTimelineRenderers();
		this.timeline = newTimeline;
	}

	private clearTimelineRenderers() {
		this.timelineRenderAbort?.abort();
		this.timelineRenderVersion++;
		for (const renderer of this.perLayerVisualModuleRenderers.values()) renderer.destroy();
		this.perLayerVisualModuleRenderers.clear();
		this.finalRenderBindGroup = null;
		this.latestRenderedToCanasTexture = null;
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

	public updatePointerPosition(newPointerPosition: { x: number; y: number }) {
		this.pointerPosition = newPointerPosition;
		this.lastPointerUpdateTimestamp = performance.now();
	}

	public changeLiveModeFpsLimit(newFpsLimit: number | null) {
		this.liveModeFpsLimit = newFpsLimit;
	}

	public setHighlightClipping(enabled: boolean) {
		this.highlightClipping = enabled;
	}

	public setTimeFactor(value: number) {
		this.timeFactor = value;
	}

	private renderToCanvas(tex: GPUTexture, commandEncoder: GPUCommandEncoder) {
		if (this.finalRenderBindGroup == null || this.latestRenderedToCanasTexture !== tex) {
			this.latestRenderedToCanasTexture = tex;
			this.finalRenderBindGroup = this.gpuDevice.createBindGroup({
				layout: this.finalRenderPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 1, resource: { buffer: this.finalRenderUniformBuffer } },
					{ binding: 3, resource: this.finalRenderSampler },
					{ binding: 2, resource: tex.createView() }, // TODO: cache view
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

		this.gpuHistogram.render(commandEncoder, tex);
		this.gpuWaveformHorizontal.render(commandEncoder, tex);
		this.gpuWaveformVertical.render(commandEncoder, tex);

		this.gpuDevice.queue.submit([commandEncoder.finish()]);
	}

	/** timeはミリ秒。表示期間中はレイヤーごとのインスタンスと履歴を保持する。 */
	public async renderTimelineAt(time: number): Promise<void> {
		if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
		this.stopRenderLoop();
		this.timelineRenderAbort?.abort();
		const controller = new AbortController();
		this.timelineRenderAbort = controller;
		const version = ++this.timelineRenderVersion;
		const activeEntries = this.timeline.filter(entry => entry.startTimeMs <= time && time < entry.endTimeMs);
		const activeIds = new Set(activeEntries.map(entry => entry.id));
		for (const [id, renderer] of this.perLayerVisualModuleRenderers) {
			if (activeIds.has(id)) continue;
			renderer.destroy();
			this.perLayerVisualModuleRenderers.delete(id);
		}
		let texture = this.fallbackTexture;
		let gpuTime = 0;
		try {
			// 配列の先頭が最下層。終端は含めず、隣接する期間が境界で重ならないようにする。
			for (const entry of activeEntries) {
				const visualModule = this.visualModules.find(visualModule => visualModule.id === entry.layer.visualModuleId);
				if (visualModule == null) continue;
				let renderer = this.perLayerVisualModuleRenderers.get(entry.id);
				if (renderer == null) {
					renderer = new VisualModuleRenderer({
						gpuDevice: this.gpuDevice,
						gpuContext: this.gpuContext,
						defaultVertexShaderModule: this.defaultVertexShaderModule,
						fallbackTexture: this.fallbackTexture,
						fallbackScalarFieldTexture: this.fallbackScalarFieldTexture,
						resolution: this.resolution,
						enable32bitDataTextures: this.enable32bitDataTextures,
						intermediateTextureFormat: this.intermediateTextureFormat,
						enableStats: this.enableStats,
						timingHelper: this.timingHelper,
						onEffectStatus: this.onEffectStatus,
						videoFrames: this.videoFrames,
						videoFrameVersions: this.videoFrameVersions,
						assets: this.assets,
						automations: this.automations,
						visualModule,
						assetTextures: this.assetTextures,
						audioSources: this.audioSources,
					});
					this.perLayerVisualModuleRenderers.set(entry.id, renderer);
				}
				const context: VisualModuleRenderContext = {
					localTime: time - entry.startTimeMs,
					// 後方シークでも履歴は保持し、負の時間差だけを0に抑える。
					localTimeDelta: renderer.lastRenderedLocalTime == null ? 0 : Math.max(0, time - entry.startTimeMs - renderer.lastRenderedLocalTime),
					layerDurationMs: entry.endTimeMs - entry.startTimeMs,
					paramValues: entry.layer.paramValues,
					paramTextures: new Map(visualModule.paramDefs.filter(def => def.isPrimaryInput).map(def => [def.id, texture])),
					pointerPosition: { x: -99999, y: -99999 },
					pointerPositionPrev: { x: -99999, y: -99999 },
				};
				await renderer.prepare(context, controller.signal);
				// 待機中に別のシーク・編集・破棄が行われた場合、古い結果を表示しない。
				if (version !== this.timelineRenderVersion) return;
				const commandEncoder = this.gpuDevice.createCommandEncoder();
				let result: GPUTexture | undefined;
				try {
					result = renderer.render(context, commandEncoder);
				} finally {
					// 描画途中の例外でもエンコーダーと計測を完了し、次のシークで再利用できるようにする。
					this.gpuDevice.queue.submit([commandEncoder.finish()]);
					if (this.enableStats) gpuTime += await this.timingHelper.getResult();
				}
				if (version !== this.timelineRenderVersion) return;
				// 各ノードが自身の出力を所有するため、レイヤー間のコピーや追加の合成は不要。
				if (result != null) texture = result;
			}
			// 有効なレイヤーがなくても透明で描画し、直前の表示を残さない。
			this.renderToCanvas(texture, this.gpuDevice.createCommandEncoder());
			if (this.enableStats) {
				this.gpuAverageFast.addSample(gpuTime / 1000);
				this.gpuAverageMedium.addSample(gpuTime / 1000);
				this.gpuAverageSlow.addSample(gpuTime / 1000);
			}
		} catch (error) {
			if (version !== this.timelineRenderVersion) return;
			this.clearTimelineRenderers();
			throw error;
		}
	}

	public updateLiveParamValues(paramValues: VisualModuleParamValues) {
		this.liveParamValues = paramValues;
	}

	public startLiveRenderLoopFor(visualModuleId: string, paramValues: VisualModuleParamValues = {}) {
		this.clearTimelineRenderers();
		this.stopRenderLoop();

		const visualModule = this.visualModules.find(g => g.id === visualModuleId);
		if (visualModule == null) return;

		this.liveVisualModuleId = visualModuleId;
		this.liveParamValues = paramValues;
		this.liveVisualModuleRenderer = new VisualModuleRenderer({
			gpuDevice: this.gpuDevice,
			gpuContext: this.gpuContext,
			defaultVertexShaderModule: this.defaultVertexShaderModule,
			fallbackTexture: this.fallbackTexture,
			fallbackScalarFieldTexture: this.fallbackScalarFieldTexture,
			resolution: this.resolution,
			enable32bitDataTextures: this.enable32bitDataTextures,
			intermediateTextureFormat: this.intermediateTextureFormat,
			enableStats: this.enableStats,
			timingHelper: this.timingHelper,
			onEffectStatus: this.onEffectStatus,
			videoFrames: this.videoFrames,
			videoFrameVersions: this.videoFrameVersions,
			assets: this.assets,
			automations: this.automations,
			visualModule,
			assetTextures: this.assetTextures,
			audioSources: this.audioSources,
		});

		let then = 0;

		const renderLoop = (timeStamp: number) => {
			this.currentLiveModeRafId = requestAnimationFrame(renderLoop);

			if (this.liveVisualModuleRenderer == null) return;

			const delta = timeStamp - then;
			if (this.liveModeFpsLimit != null) {
				const interval = 1000 / this.liveModeFpsLimit;
				if (delta <= interval) return;
				then = timeStamp - (delta % interval);
			}

			const commandEncoder = this.gpuDevice.createCommandEncoder();

			const tex = this.liveVisualModuleRenderer.render({
				paramValues: this.liveParamValues,
				localTime: timeStamp,
				localTimeDelta: delta,
				pointerPosition: this.pointerPosition,
				pointerPositionPrev: this.pointerPositionPrev,
			}, commandEncoder);
			if (tex == null) return;

			this.renderToCanvas(tex, commandEncoder);

			this.pointerPositionPrev = { ...this.pointerPosition };
			this.latestTimestamp = timeStamp;

			this.fpsAverage.addSample(1000 / delta);

			if (this.enableStats) {
				this.timingHelper.getResult().then(gpuTime => {
					this.gpuAverageFast.addSample(gpuTime / 1000);
					this.gpuAverageMedium.addSample(gpuTime / 1000);
					this.gpuAverageSlow.addSample(gpuTime / 1000);
				});
			}
		};

		this.currentLiveModeRafId = requestAnimationFrame(renderLoop);
	}

	public stopRenderLoop() {
		if (this.currentLiveModeRafId != null) {
			cancelAnimationFrame(this.currentLiveModeRafId);
			this.currentLiveModeRafId = null;
		}
		this.liveVisualModuleId = null;
		this.liveVisualModuleRenderer?.destroy();
		this.liveVisualModuleRenderer = null;
	}

	public resize(resolution: {
		width: number;
		height: number;
	}) {
		this.clearTimelineRenderers();
		this.resolution = resolution;
		this.liveVisualModuleRenderer?.resize(resolution);
	}

	public destroy() {
		this.stopRenderLoop();
		this.clearTimelineRenderers();
		for (const id of this.audioPorts.keys()) this.resetAudioSource(id, null);
		for (const frame of this.videoFrames.values()) frame.close();
		this.videoFrames.clear();
		this.videoFrameVersions.clear();
		this.gpuHistogram.dispose();
		this.gpuWaveformHorizontal.dispose();
		this.gpuWaveformVertical.dispose();

		for (const visualModuleRenderer of this.perLayerVisualModuleRenderers.values()) {
			visualModuleRenderer?.destroy();
		}
		this.perLayerVisualModuleRenderers.clear();

		this.gpuDevice?.destroy();
	}
}
