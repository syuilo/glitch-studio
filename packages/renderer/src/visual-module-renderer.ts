import { visualModuleCustomParameterId, type VisualModuleCustomParameterId } from '@glitch/shared/types.ts';
import { constantShaderInput } from '@glitch/shared/shader-input.ts';
import { getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import { playerAudioSourceId } from '@glitch/shared/audio.ts';
import { AudioHistory } from '@glitch/shared/audio-history.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.js';
import { outputShaderInput } from './node-output.ts';
import TimingHelper from './utility/TimingHelper.ts';
import { ParameterEvaluator } from './parameter-evaluator.ts';
import { moduleVariables } from './expression-scope.ts';
import { getEvaluatedParam, mapNodeParam, walkNodeParams } from './utility/node-params.ts';
import type { EvaluatedParameterValues, ParameterEvaluationContext } from './parameter-evaluator.ts';
import type { NodeOutput } from './node-output.ts';
import type { EffectStatus, EffectInstanceState } from '@glitch/shared/effect-status.ts';
import type { AudioSourceId } from '@glitch/shared/audio.ts';
import type { Asset, GsAutomationGraph, GsEffectNode, GsGlobalInNode, GsNode, NodeOutputReference, VisualModule } from '@glitch/shared/types.ts';
import type { EffectImplementation, EffectInstance, IntermediateTextureFormat } from '@glitch/shared/effect-implementation.js';
import type { EffectDefinition } from '@glitch/shared/effect-definition.js';

export type VisualModuleRenderContext = {
	isExport: boolean;
	// 省略時はタイムライン・プレビュー用の主出力だけを評価する。
	outputIds?: readonly string[];
	//globalTime: number; // タイムラインの再生位置を示すが、使わなそう
	time: number;
	timeDelta: number;
	endTime: number; // 終了時刻という概念がないコンテキスト(例: live mode)の場合はInfinityとすること。
	paramInputs?: ReadonlyMap<VisualModuleCustomParameterId, NodeOutput>;
	pointerPosition: { x: number; y: number };
	pointerPositionPrev: { x: number; y: number };
	evaluatedParamValues: EvaluatedParameterValues;
};

export class VisualModuleRenderer {
	private gpuDevice: GPUDevice;
	private gpuContext: GPUCanvasContext;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	private resolution: { width: number; height: number; };
	private nodes: GsNode[] = [];
	private paramDefs: VisualModule['paramDefs'];
	private outputDefs: VisualModule['outputDefs'] = [];
	private paramValues: EvaluatedParameterValues = new Map();
	private paramInputs: ReadonlyMap<VisualModuleCustomParameterId, NodeOutput> = new Map();
	private preparedContext: VisualModuleRenderContext | null = null;
	private statusWaiters = new Set<() => void>();
	private destroyed = false;
	private allNodeIdMap: Map<GsNode['id'], GsNode> = new Map(); // モジュール内のノードをIDで解決する。
	private evaledNodeParams: Map<GsNode['id'], Record<string, any>> = new Map();
	private effectInstances: Map<GsEffectNode['id'], EffectInstance | null> = new Map();
	private outDataMapPerNodes: Map<GsEffectNode['id'], Record<string, {
		texture: GPUTexture;
		textureView: GPUTextureView;
		previousFrameTexture?: GPUTexture;
		previousFrameTextureView?: GPUTextureView;
	}>> = new Map();
	private effectCacheKeys: Map<GsEffectNode['id'], string> = new Map();
	private lazyOutputs = new Map<string, Record<string, () => void>>();
	private usedOutputPorts = new Map<string, Set<string>>();
	private effectStatuses = new Map<string, { sent?: EffectStatus; outputs: EffectInstanceState['outputs']; published?: string }>();
	private onEffectState?: (nodeId: string, state: EffectInstanceState | null) => void;
	private automationGraphs: GsAutomationGraph[] = [];
	private enable32bitDataTextures = false;
	private readonly intermediateTextureFormat: IntermediateTextureFormat;
	private videoFrames: Map<string, VideoFrame>;
	private videoFrameVersions: Map<string, number>;
	private assetTextures: Map<string, GPUTexture>;
	private assets: Asset[];
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private timingHelper: TimingHelper;
	private enableStats = true;
	private renderNodeId: GsNode['id'] | null = null;
	private effectDefinitions: Record<string, EffectDefinition>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private parameterEvaluator = new ParameterEvaluator();

	constructor(options: {
		onEffectState?: (nodeId: string, state: EffectInstanceState | null) => void;
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
		assets: Asset[];
		visualModule: VisualModule;
		assetTextures: Map<string, GPUTexture>;
		audioSources: Map<AudioSourceId, AudioHistory>;
		effectDefinitions: Record<string, EffectDefinition>;
		effectImplementations: Record<string, EffectImplementation<any>>;
	}) {
		this.gpuDevice = options.gpuDevice;
		this.gpuContext = options.gpuContext;
		this.defaultVertexShaderModule = options.defaultVertexShaderModule;
		this.fallbackTexture = options.fallbackTexture;
		this.paramDefs = options.visualModule.paramDefs;
		this.onEffectState = options.onEffectState;
		this.enableStats = options.enableStats;
		this.resolution = options.resolution;
		this.enable32bitDataTextures = options.enable32bitDataTextures;
		this.intermediateTextureFormat = options.intermediateTextureFormat;
		this.videoFrames = options.videoFrames;
		this.videoFrameVersions = options.videoFrameVersions;
		this.assetTextures = options.assetTextures;
		this.assets = options.assets;
		this.audioSources = options.audioSources;
		this.timingHelper = options.timingHelper;
		this.effectDefinitions = options.effectDefinitions;
		this.effectImplementations = options.effectImplementations;
		this.updateVisualModule(options.visualModule);
	}

	public updateVisualModule(visualModule: VisualModule) {
		this.automationGraphs = visualModule.automationGraphs;
		this.outputDefs = visualModule.outputDefs;
		this.paramDefs = visualModule.paramDefs;
		this.preparedContext = null;
		this.paramValues = new Map();
		this.paramInputs = new Map();
		this.effectCacheKeys.clear();
		this.updateNodes(visualModule.nodes);
	}

	private getParamOutput(paramId: VisualModuleCustomParameterId): NodeOutput | undefined {
		const def = this.paramDefs.find(def => def.id === paramId);
		if (def == null || !def.canNode) return undefined;
		const input = this.paramInputs.get(paramId);
		if (input != null) return input;
		const value = this.paramValues.get(paramId);
		if (def.dataType === 'assetReference') return { kind: 'texture', texture: this.assetTextures.get(value) ?? this.fallbackTexture };
		if (def.dataType === 'bool') return constantShaderInput('scalar', Number(value ?? 0));
		return constantShaderInput(def.dataType, value);
	}

	private evaluateParameters(context: VisualModuleRenderContext) {
		this.paramInputs = context.paramInputs ?? new Map();

		const evalCtx = {
			variables: moduleVariables({
				time: context.time,
				endTime: context.endTime,
				isExport: context.isExport,
				resolution: this.resolution,
			}),
			automationGraphs: this.automationGraphs,
			time: context.time,
			endTime: context.endTime,
			evaluatedParamValues: context.evaluatedParamValues,
			paramIdsByName: new Map(this.paramDefs.map(def => [def.name, def.id])),
		} satisfies ParameterEvaluationContext;

		const evaluated = new Map<GsNode['id'], Record<string, any>>();
		for (const node of this.nodes.filter((n): n is GsEffectNode => n.type === 'effect')) {
			const paramDefs = this.effectDefinitions[node.effectId].paramDefs;
			const evaluatedParamsPerNode = {} as Record<string, any>;
			for (const [key, def] of Object.entries(paramDefs)) {
				if (node.isBypass && !def.primary) continue;
				evaluatedParamsPerNode[key] = mapNodeParam(def, node.params[key], [key], (def, param) => {
					return this.parameterEvaluator.evaluate(param, evalCtx, genEmptyValue(def)); // TODO: genEmptyValueを遅延評価したい
				});
			}
			evaluated.set(node.id, evaluatedParamsPerNode);
		}

		this.paramValues = context.evaluatedParamValues;
		this.evaledNodeParams = evaluated;
	}

	private setEffectStatus(nodeId: string, status: EffectStatus) {
		const state = this.effectStatuses.get(nodeId);
		if (!state) return;
		const previous = state.sent;
		if (previous?.type === status.type && (status.type !== 'error' || (previous.type === 'error' && previous.message === status.message))) return;
		state.sent = status;
		for (const notify of this.statusWaiters) notify();
		this.publishEffectState(nodeId);
	}

	private publishEffectState(nodeId: string) {
		const state = this.effectStatuses.get(nodeId);
		if (state?.sent == null) return;
		const snapshot: EffectInstanceState = { status: state.sent, outputs: state.outputs };
		const key = JSON.stringify(snapshot);
		if (state.published === key) return;
		state.published = key;
		this.onEffectState?.(nodeId, snapshot);
	}

	private updateOutputState(node: GsEffectNode, rendered: boolean) {
		const state = this.effectStatuses.get(node.id);
		if (state == null) return;
		// 描画完了後の出力だけ公開する。初期化用の1x1や前回の未使用出力を表示しない。
		state.outputs = Object.fromEntries(Object.entries(this.effectDefinitions[node.effectId].outputs).map(([port, def]) => {
			const texture = rendered && !node.isBypass && (!def.canLazyAllocation || this.usedOutputPorts.get(node.id)?.has(port))
				? this.outDataMapPerNodes.get(node.id)?.[port]?.texture : undefined;
			return [port, texture == null ? null : { width: texture.width, height: texture.height }];
		}));
		this.publishEffectState(node.id);
	}

	private clearEffectStatus(nodeId: string) {
		if (this.effectStatuses.delete(nodeId)) this.onEffectState?.(nodeId, null);
	}

	private evalCacheKey(node: GsNode, visited: GsNode['id'][] = []): string | null {
		if (visited.includes(node.id)) {
			throw new Error('circular dependency detected');
		}

		if (node.type === 'globalIn') {
			// 定数は値でキャッシュできる。借用テクスチャは同一オブジェクトでも内容が変わり得る。
			const outputs = Object.keys(getNodeOutputs(node, this.paramDefs)).map(id => this.getParamOutput(visualModuleCustomParameterId(id)));
			return outputs.some(output => output?.kind === 'texture') ? null : JSON.stringify([node.id, outputs]);
		}
		if (node.type === 'globalOut') return null;

		let key = `node=${node.id};isBypass=${node.isBypass};`;

		if (node.isBypass) {
			// 出力に寄与しない入力やdisableCacheには依存しない。
			// 出力元のIDもキーに含め、同じパラメータの別ノードへの切り替えを検出する。
			const output = this.getOutputNode(node);
			if (output == null) return `${key}output=none;`;
			const outputKey = this.evalCacheKey(output.node, [...visited, node.id]);
			return outputKey == null ? null : `${key}port=${output.outputPort};output=${outputKey};`;
		} else {
			if (this.effectImplementations[node.effectId].disableCache) { // TODO: 廃止(cacheVersionに一本化)
				return null;
			}
			// 非同期のリソース更新も後続ノードのキャッシュキーに伝播させる。
			key += `cacheVersion=${this.effectInstances.get(node.id)?.cacheVersion ?? 0};`;
			// 出力の利用開始・停止でも、依存先を含めキャッシュを更新する。
			if (this.lazyOutputs.has(node.id)) key += `ports=${JSON.stringify([...(this.usedOutputPorts.get(node.id) ?? [])].sort())};`;

			const paramDefs = this.effectDefinitions[node.effectId].paramDefs;

			const params = this.evaledNodeParams.get(node.id)!;
			// 空配列・空structや要素数の変化もキーに含める。
			key += JSON.stringify(params);
			for (const { def, param, path } of walkNodeParams(paramDefs, node.params)) {
				const v = getEvaluatedParam(params, path);
				key += JSON.stringify([path, param.inputSource]);
				if (param.inputSource === 'node' && param.nodeId != null) {
					key += JSON.stringify([param.fitMode ?? 'cover', param.wrapMode ?? 'repeatMirrored', param.filterMode ?? 'linear']);
				}
				// 外部から渡されたテクスチャは同じオブジェクトの内容が毎フレーム変わり得る。
				if (def.canNode && param.inputSource === 'externalCustomParameterInput') {
					const input = this.paramInputs.get(param.parameterId);
					if (input?.kind === 'texture') return null;
					key += JSON.stringify(input);
				}
				if (def.dataType === 'playerReference') {
					key += JSON.stringify([path, 'videoFrameVersion', v == null ? 0 : this.videoFrameVersions.get(v) ?? 0]);
					const audio = v == null ? undefined : this.audioSources.get(playerAudioSourceId(v));
					key += JSON.stringify([path, 'audio', audio == null ? null : [audio.generation, audio.revision, audio.endFrame]]);
				}
				if (def.canNode && param.inputSource === 'node' && param.nodeId != null) {
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
		for (const [key, def] of Object.entries(this.effectDefinitions[node.effectId].paramDefs)) {
			resolvedParams[key] = mapNodeParam(def, node.params[key], [key], (def, param, path) => {
				const v = getEvaluatedParam(params, path);
				if (def.dataType === 'assetReference') return this.assetTextures.get(v) ?? null;
				if (def.dataType === 'videoAssetReference') return this.assets.find(asset => asset.id === v && asset.fileDataType.startsWith('video/')) ?? null;
				if (def.dataType === 'playerReference') return v == null ? null : {
					videoFrame: this.videoFrames.get(v) ?? null,
					audio: this.audioSources.get(playerAudioSourceId(v)) ?? null,
				};
				if (def.canNode) {
					if (param.inputSource === 'node' && param.nodeId != null) {
						const output = this.getOutputValue(this.allNodeIdMap.get(param.nodeId)!, param.outputPort);
						return output == null ? constantShaderInput(def.dataType, null) : outputShaderInput(output, param);
					}
					if (param.inputSource === 'externalCustomParameterInput') {
						const input = this.paramInputs.get(param.parameterId);
						if (input != null) return outputShaderInput(input);
					}
					return constantShaderInput(def.dataType, v);
				}
				return v;
			});
		}
		return resolvedParams;
	}

	private prepareOutputPorts(node: GsNode, outputIds: readonly string[]): void {
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
			for (const { def, param } of walkNodeParams(this.effectDefinitions[output.node.effectId].paramDefs, output.node.params)) {
				if (!def.canNode || param.inputSource !== 'node' || param.nodeId == null) continue;
				const source = this.allNodeIdMap.get(param.nodeId);
				if (source != null) visit(source, param.outputPort ?? undefined);
			}
		};
		for (const id of outputIds) visit(node, id);
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
			const effect = this.effectImplementations[node.effectId];
			const allocationArgs = {
				wgpu: { device: this.gpuDevice, enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat },
				// 入力依存のサイズはパラメータ評価後に確定する。仮の出力へ大きな領域を確保しない。
				resolution: effect.getOutputResolution ? { width: 1, height: 1 } : { ...this.resolution },
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
				if (this.effectDefinitions[node.effectId].outputs[k].canLazyAllocation === true) lazy[k] = allocate;
				else allocate();
			}
			if (Object.keys(lazy).length > 0) this.lazyOutputs.set(node.id, lazy);
			this.outDataMapPerNodes.set(node.id, outDataMap);
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
		}

		for (const node of newEffectNodes) {
			if (node.isBypass) {
				this.updateOutputState(node, false);
				// 再有効化時に出力情報も再確定する。
				this.effectCacheKeys.delete(node.id);
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
		this.preparedContext = null;
		// 同じAsset IDでもテクスチャを作り直すため、ネスト内の画像参照も再解決する。
		this.effectCacheKeys.clear();
	}

	// 無効なエフェクトは主入力をそのまま公開する。テクスチャの所有権や履歴は元のノードに残す。
	// 描画・入力参照・キャッシュが同じ接続関係を扱うよう、ここで共通して解決する。
	private getOutputNode(node: GsNode, outputPort?: string, visited: GsNode['id'][] = []): { node: GsEffectNode | GsGlobalInNode; outputPort: string } | undefined {
		if (visited.includes(node.id)) throw new Error('circular dependency detected');
		const nextVisited = [...visited, node.id];
		if (node.type === 'globalIn') {
			const port = outputPort ?? this.paramDefs.find(def => def.isPrimaryInput)?.id;
			return port != null && getNodeOutputs(node, this.paramDefs)[port] != null ? { node, outputPort: port } : undefined;
		}
		if (node.type === 'globalOut') {
			const port = outputPort ?? this.outputDefs.find(def => def.isPrimaryOutput)?.id;
			if (port == null || !this.outputDefs.some(def => def.id === port)) return;
			const input = node.inputs[port];
			const source = input?.nodeId == null ? undefined : this.allNodeIdMap.get(input.nodeId);
			return source == null ? undefined : this.getOutputNode(source, input.outputPort ?? undefined, nextVisited);
		}
		if (!node.isBypass) {
			const port = outputPort ?? Object.entries(this.effectDefinitions[node.effectId].outputs).find(([, def]) => def.primary)?.[0];
			return port == null || this.effectDefinitions[node.effectId].outputs[port] == null ? undefined : { node, outputPort: port };
		}
		const primary = Object.entries(this.effectDefinitions[node.effectId].paramDefs).find(([, def]) => def.primary);
		const input: NodeOutputReference | null = primary ? this.evaledNodeParams.get(node.id)![primary[0]] : null;
		// バイパスでは自身の出力名ではなく、主入力が選択した出力ポートを公開する。
		const source = input == null ? undefined : this.allNodeIdMap.get(input.nodeId);
		return source == null ? undefined : this.getOutputNode(source, input!.outputPort, nextVisited);
	}

	private getOutputValue(node: GsNode, outputPort: string): NodeOutput | undefined {
		const output = this.getOutputNode(node, outputPort);
		if (output == null) return undefined;
		if (output.node.type === 'globalIn') return this.getParamOutput(visualModuleCustomParameterId(output.outputPort));
		const texture = this.outDataMapPerNodes.get(output.node.id)?.[output.outputPort]?.texture;
		return texture == null ? undefined : { kind: 'texture', texture };
	}

	private renderNode(node: GsNode, commandEncoder: GPUCommandEncoder, context: VisualModuleRenderContext & {
		visited: Set<GsNode['id']>;
		rendered: Set<GsNode['id']>;
	}): void {
		if (node.type === 'globalIn') return;
		if (node.type === 'globalOut') {
			for (const id of this.getRequestedOutputIds(context)) {
				const output = this.getOutputNode(node, id);
				if (output != null) this.renderNode(output.node, commandEncoder, context);
			}
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

		const effect = this.effectImplementations[node.effectId];

		const params = this.evaledNodeParams.get(node.id)!;

		for (const { def, param } of walkNodeParams(this.effectDefinitions[node.effectId].paramDefs, node.params)) {
			if (!def.canNode || param.inputSource !== 'node' || param.nodeId == null) continue;
			const targetNode = this.allNodeIdMap.get(param.nodeId);
			if (targetNode == null) throw new Error('Referenced node not found');
			this.renderNode(targetNode, commandEncoder, {
				...context,
				visited: new Set([...context.visited, node.id]),
				rendered: context.rendered,
			});
		}

		const resolvedParams = this.resolveParams(node, params);
		if (effect.getOutputResolution) {
			for (const [port, data] of Object.entries(this.outDataMapPerNodes.get(node.id)!)) {
				const resolution = effect.getOutputResolution(resolvedParams, port) ?? this.resolution;
				if (data.texture.width === resolution.width && data.texture.height === resolution.height) continue;
				const args = { resolution, wgpu: { device: this.gpuDevice, enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat } };
				const texture = effect.outputTextureFactories[port](args);
				const previous = effect.needsPreviousFrame ? effect.outputTextureFactories[port](args) : undefined;
				data.texture.destroy();
				data.previousFrameTexture?.destroy();
				data.texture = texture;
				data.textureView = texture.createView();
				data.previousFrameTexture = previous;
				data.previousFrameTextureView = previous?.createView();
			}
		}

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
			time: context.time / 1000,
			timeDelta: context.timeDelta,
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

		this.updateOutputState(node, true);
		context.rendered.add(node.id);
		if (key != null) this.effectCacheKeys.set(node.id, key);
		else this.effectCacheKeys.delete(node.id);
	}

	private initializeEffect(node: GsEffectNode, params: Record<string, any>): EffectInstance {
		const existing = this.effectInstances.get(node.id);
		if (existing != null) return existing;
		const state: { sent?: EffectStatus; outputs: EffectInstanceState['outputs']; published?: string } = { outputs: Object.fromEntries(Object.keys(this.effectDefinitions[node.effectId].outputs).map(port => [port, null])) };
		this.effectStatuses.set(node.id, state);
		const instance = this.effectImplementations[node.effectId].init({
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

		this.evaluateParameters(context);
		this.prepareOutputPorts(node, this.getRequestedOutputIds(context));

		const prepared = new Set<string>();

		const visit = (target: GsNode, visited: string[], port?: string) => {
			if (visited.includes(target.id)) throw new Error('circular dependency detected');
			if (prepared.has(target.id)) return;
			const output = this.getOutputNode(target, port);
			if (output == null || output.node.type === 'globalIn') return;
			const effectNode = output.node;
			if (prepared.has(effectNode.id)) return;
			for (const { def, param } of walkNodeParams(this.effectDefinitions[effectNode.effectId].paramDefs, effectNode.params)) {
				if (!def.canNode || param.inputSource !== 'node' || param.nodeId == null) continue;
				const source = this.allNodeIdMap.get(param.nodeId);
				if (source == null) throw new Error('Referenced node not found');
				visit(source, [...visited, target.id, effectNode.id], param.outputPort ?? undefined);
			}
			const params = this.resolveParams(effectNode, this.evaledNodeParams.get(effectNode.id)!);
			this.initializeEffect(effectNode, params).prepare?.(params);
			prepared.add(effectNode.id);
		};

		for (const id of this.getRequestedOutputIds(context)) {
			visit(node, [], id);
		}

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

	private getRequestedOutputIds(context: VisualModuleRenderContext): readonly string[] {
		return context.outputIds ?? this.outputDefs.filter(def => def.isPrimaryOutput).map(def => def.id);
	}

	private renderOutputs(context: VisualModuleRenderContext, commandEncoder: GPUCommandEncoder): Map<string, NodeOutput> {
		const outputs = new Map<string, NodeOutput>();
		if (this.renderNodeId == null) return outputs;
		const node = this.allNodeIdMap.get(this.renderNodeId);
		if (node == null) return outputs;

		// 準備時と同じ評価結果を使い、式の再評価によるリソースの再読み込みを防ぐ。
		if (this.preparedContext !== context) {
			this.evaluateParameters(context);
		}
		this.preparedContext = null;

		this.prepareOutputPorts(node, this.getRequestedOutputIds(context));

		this.renderNode(node, commandEncoder, {
			...context,
			visited: new Set<GsNode['id']>(),
			rendered: new Set<GsNode['id']>(),
		});

		for (const id of this.getRequestedOutputIds(context)) {
			const value = this.getOutputValue(node, id);
			if (value != null) outputs.set(id, value);
		}
		return outputs;
	}

	public render(context: VisualModuleRenderContext, commandEncoder: GPUCommandEncoder): NodeOutput | undefined {
		const outputs = this.renderOutputs(context, commandEncoder);
		const primary = this.outputDefs.find(def => def.isPrimaryOutput);
		return primary == null ? undefined : outputs.get(primary.id);
	}

	// TODO: もっとスマートなリソース更新方法を考える
	public resize(resolution: {
		width: number;
		height: number;
	}) {
		this.resolution = resolution;
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
		for (const notify of this.statusWaiters) notify();
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
