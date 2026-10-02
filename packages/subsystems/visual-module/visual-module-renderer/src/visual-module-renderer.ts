import { scaleResolution, type Resolution } from '@glitch/shared/resolution.ts';
import { visualModuleCustomParameterId, type VisualModuleCustomParameterId } from '@glitch/shared/visual-module/types.ts';
import { constantShaderInput } from '@glitch/effect-shared/shader-input.ts';
import { getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import { playerAudioSourceId } from '@glitch/shared/audio.ts';
import { AudioHistory } from '@glitch/shared/audio-history.ts';
import { genEmptyValue } from '@glitch/shared/utility/misc.js';
import { ParameterEvaluator } from '@glitch/shared/parameter-evaluator.js';
import { validateEnumParameterValue } from '@glitch/shared/parameter.ts';
import { EffectRenderer } from '@glitch/effect-renderer/effect-renderer.ts';
import { resolveEffectNodeResolution } from '../../../../renderer/src/effect-node-resolution.ts';
import { outputShaderInput } from '../../../../renderer/src/node-output.ts';
import { resolveEffectParameterValue } from '../../../../renderer/src/effect-parameter-value.ts';
import { getEvaluatedParam, mapNodeParam, walkNodeParams } from '../../../../renderer/src/utility/node-params.ts';
import defaultVertexShaderCode from './vertex.wgsl?raw';
import type TimingHelper from '../../../../renderer/src/utility/TimingHelper.ts';
import type { EvaluatedParameterValues, ParameterEvaluationContext } from '@glitch/shared/parameter-evaluator.js';
import type { NodeOutput } from '../../../../renderer/src/node-output.ts';
import type { EffectInstanceState } from '@glitch/effect-shared/effect-status.ts';
import type { AudioSourceId } from '@glitch/shared/audio.ts';
import type { Asset, AutomationGraph, IntermediateTextureFormat } from '@glitch/shared/types.ts';
import type { VisualModuleEffectNode, VisualModuleGlobalInNode, VisualModuleNode, NodeOutputReference, VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { EffectImplementation } from '@glitch/effect-shared/effect-implementation.js';
import type { EffectDefinition } from '@glitch/effect-shared/effect-definition.js';
import type { IN_VISUAL_MODULE_VAR_DEFS } from '@glitch/shared/expression.js';

const NO_OUTPUT_PORTS: ReadonlySet<string> = new Set();

export type VisualModuleRenderContext = {
	isExport: boolean;
	// 省略時はタイムライン・プレビュー用の主出力だけを評価する。
	outputIds?: readonly string[];
	//globalTime: number; // タイムラインの再生位置を示すが、使わなそう
	time: number;
	timeDelta: number;
	endTime: number; // 終了時刻という概念がないコンテキスト(例: live mode)の場合はInfinityとすること。
	/** 内容時刻と独立した表示区間の進行率。タイムラインの呼び出し側で計算する。 */
	progress?: number;
	paramInputs?: ReadonlyMap<VisualModuleCustomParameterId, NodeOutput>;
	pointerPosition: { x: number; y: number };
	pointerPositionPrev: { x: number; y: number };
	evaluatedParamValues: EvaluatedParameterValues;
};

export class VisualModuleRenderer {
	private gpuDevice: GPUDevice;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	/** 呼び出し側から与えられた描画基準。倍率適用済みで、個々のノード寸法とは異なる。 */
	private contextResolution: Resolution;
	private resolutionScale: number;
	private nodes: VisualModuleNode[] = [];
	private paramDefs: VisualModule['paramDefs'];
	private outputDefs: VisualModule['outputDefs'] = [];
	private primaryOutputId: string | null = null;
	private primaryInputId: VisualModuleCustomParameterId | null = null;
	private paramValues: EvaluatedParameterValues = new Map();
	private paramInputs: ReadonlyMap<VisualModuleCustomParameterId, NodeOutput> = new Map();
	private preparedContext: VisualModuleRenderContext | null = null;
	private preparationVersion = 0;
	private destroyed = false;
	private allNodeIdMap: Map<VisualModuleNode['id'], VisualModuleNode> = new Map(); // モジュール内のノードをIDで解決する。
	private evaledNodeParams: Map<VisualModuleNode['id'], Record<string, any>> = new Map();
	private effectRenderers = new Map<string, EffectRenderer>();
	private effectCacheKeys: Map<VisualModuleEffectNode['id'], string> = new Map();
	private lazyEffectRenderers = new Map<string, EffectRenderer>();
	private usedOutputPorts = new Map<string, Set<string>>();
	private onEffectState?: (nodeId: string, state: EffectInstanceState | null) => void;
	private automationGraphs: AutomationGraph[] = [];
	private enable32bitDataTextures = false;
	private readonly intermediateTextureFormat: IntermediateTextureFormat;
	private videoFrames: Map<string, VideoFrame>;
	private videoFrameVersions: Map<string, number>;
	private assetTextures: Map<string, GPUTexture>;
	private assets: Asset[];
	private audioSources = new Map<AudioSourceId, AudioHistory>();
	private timingHelper: TimingHelper | null;
	private enableStats = true;
	private renderNodeId: VisualModuleNode['id'] | null = null;
	private effectDefinitions: Record<string, EffectDefinition>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private parameterEvaluator = new ParameterEvaluator();

	constructor(options: {
		onEffectState?: (nodeId: string, state: EffectInstanceState | null) => void;
		enableStats: boolean;
		timingHelper: TimingHelper | null;
		gpuDevice: GPUDevice;
		fallbackTexture: GPUTexture;
		resolution: Resolution;
		resolutionScale?: number;
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
		this.fallbackTexture = options.fallbackTexture;
		this.paramDefs = options.visualModule.paramDefs;
		this.onEffectState = options.onEffectState;
		this.enableStats = options.enableStats;
		this.resolutionScale = options.resolutionScale ?? 1;
		this.contextResolution = scaleResolution(options.resolution, this.resolutionScale);
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
		this.defaultVertexShaderModule = this.gpuDevice.createShaderModule({
			code: defaultVertexShaderCode,
		});
		this.updateVisualModule(options.visualModule);
	}

	public updateVisualModule(visualModule: VisualModule, preserveCache = false) {
		this.automationGraphs = visualModule.automationGraphs;
		this.outputDefs = visualModule.outputDefs;
		this.primaryOutputId = visualModule.primaryOutputId;
		this.primaryInputId = visualModule.primaryInputId;
		this.paramDefs = visualModule.paramDefs;
		this.preparedContext = null;
		this.paramValues = new Map();
		this.paramInputs = new Map();
		// 値の編集では既存のキーと再評価結果を比較する。全消去すると無関係な上流も描画される。
		// 準備中のフレームはupdateNodesの世代更新で無効化し、出力キャッシュとは分ける。
		if (!preserveCache) this.effectCacheKeys.clear();
		this.updateNodes(visualModule.nodes);
	}

	private getParamOutput(paramId: VisualModuleCustomParameterId): NodeOutput | undefined {
		const def = this.paramDefs.find(def => def.id === paramId);
		if (def == null || !def.canNode) return undefined;
		const input = this.paramInputs.get(paramId);
		if (input != null) return input;
		const value = this.paramValues.get(paramId);
		return constantShaderInput(def.dataType.kind, value);
	}

	private evaluateParameters(context: VisualModuleRenderContext) {
		this.paramInputs = context.paramInputs ?? new Map();
		// モジュール内部の式から直接参照できるのはcanNode: falseのパラメータだけ。
		// canNode: trueは定数でもInノード経由で読み、定数／テクスチャで参照方法を変えない。
		// Inノード用の評価済み値は保持し、式へ渡す値と参照名だけを絞り込む。
		const expressionParamDefs = this.paramDefs.filter(def => !def.canNode);

		const evalCtx = {
			variables: {
				WIDTH: this.contextResolution.width,
				HEIGHT: this.contextResolution.height,
				TIME: context.time / 1000,
				TIME_MS: context.time,
				END_TIME: context.endTime / 1000,
				END_TIME_MS: context.endTime,
				PROGRESS: context.progress ?? context.time / context.endTime,
				IS_EXPORT: context.isExport,
				TEST_ONLY_VM: true,
				TEST_SAME_NAME: 1,
			} satisfies Record<typeof IN_VISUAL_MODULE_VAR_DEFS[number], unknown>,
			automationGraphs: this.automationGraphs,
			time: context.time,
			endTime: context.endTime,
			evaluatedParamValues: new Map(expressionParamDefs.filter(def => context.evaluatedParamValues.has(def.id))
				.map(def => [def.id, context.evaluatedParamValues.get(def.id)])),
			paramIdsByName: new Map(expressionParamDefs.map(def => [def.nameForReference, def.id])),
		} satisfies ParameterEvaluationContext;

		const evaluated = new Map<VisualModuleNode['id'], Record<string, any>>();
		for (const node of this.nodes.filter((n): n is VisualModuleEffectNode => n.type === 'effect')) {
			const paramDefs = this.effectDefinitions[node.effectId].paramDefs;
			const evaluatedParamsPerNode = {} as Record<string, any>;
			for (const [key, def] of Object.entries(paramDefs)) {
				if (node.isBypass && key !== this.effectDefinitions[node.effectId].primaryInputParameter) continue;
				evaluatedParamsPerNode[key] = mapNodeParam(def, node.params[key], [key], (def, param) => {
					return validateEnumParameterValue(def, this.parameterEvaluator.evaluate(param, evalCtx,
						def.dataType.kind === 'enum' ? undefined : genEmptyValue(def))); // TODO: genEmptyValueを遅延評価したい
				});
			}
			evaluated.set(node.id, evaluatedParamsPerNode);
		}

		this.paramValues = context.evaluatedParamValues;
		this.evaledNodeParams = evaluated;
	}

	private evalCacheKey(node: VisualModuleNode, visited: VisualModuleNode['id'][] = [], outputPort?: string): string | null {
		if (visited.includes(node.id)) {
			throw new Error('circular dependency detected');
		}

		if (node.type === 'globalIn') {
			// 定数は値でキャッシュできる。借用テクスチャは同一オブジェクトでも内容が変わり得る。
			// 別の公開入力の値変更を、このポートだけを読む枝へ伝播させない。
			const ids = outputPort == null ? Object.keys(getNodeOutputs(node, this.paramDefs)) : [outputPort];
			const outputs = ids.map(id => this.getParamOutput(visualModuleCustomParameterId(id)));
			return outputs.some(output => output?.kind === 'texture') ? null : JSON.stringify([node.id, ids, outputs]);
		}
		if (node.type === 'globalOut') return null;

		let key = node.type === 'relay' ? `node=${node.id};type=relay;` : `node=${node.id};isBypass=${node.isBypass};`;

		if (node.type === 'relay' || node.isBypass) {
			// 出力に寄与しない入力やdisableCacheには依存しない。
			// 出力元のIDもキーに含め、同じパラメータの別ノードへの切り替えを検出する。
			const output = this.getOutputNode(node);
			if (output == null) return `${key}output=none;`;
			const outputKey = this.evalCacheKey(output.node, [...visited, node.id], output.outputPort);
			return outputKey == null ? null : `${key}port=${output.outputPort};output=${outputKey};`;
		} else {
			if (this.effectImplementations[node.effectId].disableCache) { // TODO: 廃止(cacheVersionに一本化)
				return null;
			}
			// 非同期のリソース更新も後続ノードのキャッシュキーに伝播させる。
			const renderer = this.effectRenderers.get(node.id)!;
			key += JSON.stringify([node.resolution, renderer.resolution]);
			key += `cacheVersion=${renderer.cacheVersion};resources=${renderer.resourceVersion};`;
			// 出力の利用開始・停止でも、依存先を含めキャッシュを更新する。
			if (renderer.hasLazyOutputs) key += `ports=${JSON.stringify([...(this.usedOutputPorts.get(node.id) ?? [])].sort())};`;

			const paramDefs = this.effectDefinitions[node.effectId].paramDefs;

			const params = this.evaledNodeParams.get(node.id)!;
			// 空配列・空structや要素数の変化もキーに含める。
			key += JSON.stringify(params);
			for (const { def, param, path } of walkNodeParams(paramDefs, node.params)) {
				const v = getEvaluatedParam(params, path);
				key += JSON.stringify([path, param.inputSource]);
				if (param.inputSource === 'node' && param.nodeId != null) {
					key += JSON.stringify([param.fitMode, param.wrapMode, param.filterMode]);
				}
				// 外部から渡されたテクスチャは同じオブジェクトの内容が毎フレーム変わり得る。
				if (def.canNode && param.inputSource === 'externalCustomParameterInput') {
					const input = this.paramInputs.get(param.parameterId);
					if (input?.kind === 'texture') return null;
					key += JSON.stringify(input);
				}
				if (def.dataType.kind === 'playerReference') {
					key += JSON.stringify([path, 'videoFrameVersion', v == null ? 0 : this.videoFrameVersions.get(v) ?? 0]);
					const audio = v == null ? undefined : this.audioSources.get(playerAudioSourceId(v));
					key += JSON.stringify([path, 'audio', audio == null ? null : [audio.generation, audio.revision, audio.endFrame]]);
				}
				if (def.canNode && param.inputSource === 'node' && param.nodeId != null) {
					const targetNode = this.allNodeIdMap.get(param.nodeId);
					if (targetNode == null) throw new Error('Referenced node not found');
					const targetNodeCacheKey = this.evalCacheKey(targetNode, [...visited, node.id], param.outputPort ?? undefined);
					if (targetNodeCacheKey == null) return null;
					key += JSON.stringify([path, targetNodeCacheKey]);
				}
			}
		}

		return key;
	}

	private resolveParams(node: VisualModuleEffectNode, params: Record<string, any>): Record<string, any> {
		const resolvedParams: Record<string, any> = {};
		for (const [key, def] of Object.entries(this.effectDefinitions[node.effectId].paramDefs)) {
			resolvedParams[key] = mapNodeParam(def, node.params[key], [key], (def, param, path) => {
				const v = getEvaluatedParam(params, path);
				if (def.dataType.kind === 'playerReference') return v == null ? null : {
					videoFrame: this.videoFrames.get(v) ?? null,
					audio: this.audioSources.get(playerAudioSourceId(v)) ?? null,
				};
				if (def.canNode && param.inputSource === 'node' && param.nodeId != null) {
					const output = this.getOutputValue(this.allNodeIdMap.get(param.nodeId)!, param.outputPort);
					return output == null ? constantShaderInput(def.dataType.kind, null) : outputShaderInput(output, param);
				}
				return resolveEffectParameterValue(def, v, { assets: this.assets, assetTextures: this.assetTextures });
			});
		}
		return resolvedParams;
	}

	private prepareOutputPorts(node: VisualModuleNode, outputIds: readonly string[]): void {
		this.usedOutputPorts.clear();
		const visit = (target: VisualModuleNode, port?: string) => {
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
		for (const [id, renderer] of this.lazyEffectRenderers) {
			renderer.setUsedOutputPorts(this.usedOutputPorts.get(id) ?? NO_OUTPUT_PORTS);
		}
	}

	// (非workerで)呼び出すときはnewNodesを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateNodes(newNodes: VisualModuleNode[]) {
		this.preparedContext = null;
		++this.preparationVersion;
		const oldEffectNodes = this.nodes.filter(node => node.type === 'effect');
		const newEffectNodes = newNodes.filter(node => node.type === 'effect');
		const oldNodeIds = new Set(oldEffectNodes.map(node => node.id));
		const newNodeIds = new Set(newEffectNodes.map(node => node.id));
		const addedNodes = newEffectNodes.filter(node => !oldNodeIds.has(node.id));
		const removedNodes = oldEffectNodes.filter(node => !newNodeIds.has(node.id));

		for (const node of removedNodes) {
			this.effectRenderers.get(node.id)?.dispose();
			this.effectRenderers.delete(node.id);
			this.lazyEffectRenderers.delete(node.id);
			this.usedOutputPorts.delete(node.id);
			this.effectCacheKeys.delete(node.id);
		}

		for (const node of addedNodes) {
			// 自動解像度は上流・素材の解決まで未確定。それまでは小さい仮出力を使う。
			const resolution = node.resolution.mode === 'auto' ? undefined : resolveEffectNodeResolution({
				setting: node.resolution, contextResolution: this.contextResolution, resolutionScale: this.resolutionScale,
				maxDimension: this.gpuDevice.limits.maxTextureDimension2D,
			});
			const renderer = new EffectRenderer({
				definition: this.effectDefinitions[node.effectId],
				implementation: this.effectImplementations[node.effectId],
				resolution,
				wgpu: {
					device: this.gpuDevice, defaultVertexShaderModule: this.defaultVertexShaderModule,
					enable32bitDataTextures: this.enable32bitDataTextures, intermediateTextureFormat: this.intermediateTextureFormat,
				},
				fallbackTexture: this.fallbackTexture, enableStats: this.enableStats, timingHelper: this.timingHelper,
				onState: state => this.onEffectState?.(node.id, state),
			});
			this.effectRenderers.set(node.id, renderer);
			if (renderer.hasLazyOutputs) this.lazyEffectRenderers.set(node.id, renderer);
		}

		for (const node of newEffectNodes) {
			if (node.isBypass) {
				this.effectRenderers.get(node.id)!.clearOutputState();
				// 履歴を維持したまま公開だけを休止し、再有効化時に再描画する。
				this.effectCacheKeys.delete(node.id);
			}
		}
		this.nodes = newNodes;
		this.allNodeIdMap = new Map(newNodes.map(node => [node.id, node]));
		this.renderNodeId = this.nodes.find(node => node.type === 'globalOut')?.id ?? null;
	}

	public updateAssets(assets: Asset[]) {
		this.assets = assets;
		this.preparedContext = null;
		++this.preparationVersion;
		// 同じAsset IDでもテクスチャを作り直すため、ネスト内の画像参照も再解決する。
		this.effectCacheKeys.clear();
	}

	// relayと無効なエフェクトは入力をそのまま公開する。テクスチャの所有権や履歴は元のノードに残す。
	// 描画・入力参照・キャッシュが同じ接続関係を扱うよう、ここで共通して解決する。
	private getOutputNode(node: VisualModuleNode, outputPort?: string, visited: VisualModuleNode['id'][] = []): { node: VisualModuleEffectNode | VisualModuleGlobalInNode; outputPort: string } | undefined {
		if (visited.includes(node.id)) throw new Error('circular dependency detected');
		const nextVisited = [...visited, node.id];
		if (node.type === 'relay') {
			if (outputPort != null && outputPort !== 'output') return;
			const input = node.input;
			const source = input.nodeId == null ? undefined : this.allNodeIdMap.get(input.nodeId);
			if (source == null || input.outputPort == null) return;
			// 出力ポートの存在だけ確認する。異なる型の接続も許容するため、
			// relayの宣言型で入力を拒否・変換せず、元の出力をそのまま渡す。
			const outputs = source.type === 'effect' ? this.effectDefinitions[source.effectId].outputDefs : getNodeOutputs(source, this.paramDefs);
			if (outputs[input.outputPort] == null) return;
			return this.getOutputNode(source, input.outputPort, nextVisited);
		}
		if (node.type === 'globalIn') {
			const port = outputPort ?? this.primaryInputId;
			return port != null && getNodeOutputs(node, this.paramDefs)[port] != null ? { node, outputPort: port } : undefined;
		}
		if (node.type === 'globalOut') {
			const port = outputPort ?? this.primaryOutputId;
			if (port == null || !this.outputDefs.some(def => def.id === port)) return;
			const input = node.inputs[port];
			const source = input?.nodeId == null ? undefined : this.allNodeIdMap.get(input.nodeId);
			return source == null ? undefined : this.getOutputNode(source, input.outputPort ?? undefined, nextVisited);
		}
		if (!node.isBypass) {
			const port = outputPort ?? this.effectDefinitions[node.effectId].primaryOutput;
			return port == null || this.effectDefinitions[node.effectId].outputDefs[port] == null ? undefined : { node, outputPort: port };
		}
		const primary = this.effectDefinitions[node.effectId].primaryInputParameter;
		const input: NodeOutputReference | null = primary !== null ? this.evaledNodeParams.get(node.id)![primary] : null;
		// バイパスでは自身の出力名ではなく、主入力が選択した出力ポートを公開する。
		const source = input == null ? undefined : this.allNodeIdMap.get(input.nodeId);
		return source == null ? undefined : this.getOutputNode(source, input!.outputPort, nextVisited);
	}

	private getOutputValue(node: VisualModuleNode, outputPort: string): NodeOutput | undefined {
		const output = this.getOutputNode(node, outputPort);
		if (output == null) return undefined;
		if (output.node.type === 'globalIn') return this.getParamOutput(visualModuleCustomParameterId(output.outputPort));
		const texture = this.effectRenderers.get(output.node.id)?.getOutputTexture(output.outputPort);
		return texture == null ? undefined : { kind: 'texture', texture };
	}

	private renderNode(node: VisualModuleNode, commandEncoder: GPUCommandEncoder, context: VisualModuleRenderContext & {
		visited: Set<VisualModuleNode['id']>;
		rendered: Set<VisualModuleNode['id']>;
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

		if (node.type === 'relay' || node.isBypass) {
			// relayとバイパスは自身を描画せず、解決した入力だけを更新する。
			// バイパスしたエフェクトの履歴は保持して再有効化時に再開する。
			const output = this.getOutputNode(node);
			if (output == null) return;
			return this.renderNode(output.node, commandEncoder, {
				...context,
				visited: new Set([...context.visited, node.id]),
				rendered: context.rendered,
			});
		}

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
		this.ensureNodeResolution(node, resolvedParams);
		this.effectRenderers.get(node.id)!.initialize(resolvedParams);
		// 上流のサイズ・非同期リソース更新を確定させてからキャッシュを判定する。
		const key = this.evalCacheKey(node);
		if (key != null && key === this.effectCacheKeys.get(node.id)) {
			context.rendered.add(node.id);
			return;
		}

		const renderer = this.effectRenderers.get(node.id)!;
		renderer.render({
			time: context.time / 1000,
			timeDelta: context.timeDelta,
			pointerPosition: context.pointerPosition,
			pointerVector: {
				x: context.pointerPositionPrev.x === -99999 ? 0 : context.pointerPosition.x - context.pointerPositionPrev.x,
				y: context.pointerPositionPrev.y === -99999 ? 0 : context.pointerPosition.y - context.pointerPositionPrev.y,
			},
			params: resolvedParams,
			usedOutputPorts: this.usedOutputPorts.get(node.id),
			commandEncoder,
		});
		context.rendered.add(node.id);
		if (key != null) this.effectCacheKeys.set(node.id, key);
		else this.effectCacheKeys.delete(node.id);
	}

	private ensureNodeResolution(node: VisualModuleEffectNode, params: Record<string, any>) {
		const effect = this.effectImplementations[node.effectId];
		const inputKey = this.effectDefinitions[node.effectId].resolutionInputParameter;
		const input = inputKey == null ? undefined : params[inputKey];
		this.effectRenderers.get(node.id)!.setResolution(resolveEffectNodeResolution({
			setting: node.resolution, contextResolution: this.contextResolution,
			resolutionScale: this.resolutionScale,
			intrinsicResolution: node.resolution.mode === 'auto' ? effect.getIntrinsicResolution?.(params) : undefined,
			inputResolution: input?.kind === 'texture' ? input.texture : undefined,
			maxDimension: this.gpuDevice.limits.maxTextureDimension2D,
		}));
	}

	// 描画せずに初期化・パラメータ変更の準備を行い、履歴を余分に進めない。
	public async prepare(context: VisualModuleRenderContext, signal: AbortSignal): Promise<void> {
		if (signal.aborted || this.destroyed) return;
		const preparationVersion = ++this.preparationVersion;
		this.preparedContext = null;
		const node = this.renderNodeId == null ? undefined : this.allNodeIdMap.get(this.renderNodeId);
		if (node == null) return;

		this.evaluateParameters(context);
		this.prepareOutputPorts(node, this.getRequestedOutputIds(context));

		const prepared = new Set<string>();

		const visit = (target: VisualModuleNode, visited: string[], port?: string) => {
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
			this.ensureNodeResolution(effectNode, params);
			this.effectRenderers.get(effectNode.id)!.prepare(params);
			prepared.add(effectNode.id);
		};

		for (const id of this.getRequestedOutputIds(context)) {
			visit(node, [], id);
		}

		// 各エフェクトの準備は先に開始し、待機だけをまとめる。失敗時には他の待機も
		// 終了させるが、エフェクト自体は破棄せず、次の要求でリソース・履歴を再利用する。
		const waitController = new AbortController();
		const waitSignal = AbortSignal.any([signal, waitController.signal]);
		try {
			const ready = await Promise.all([...prepared].map(id => this.effectRenderers.get(id)!.waitUntilReady(waitSignal).then(ready => {
				if (!ready) waitController.abort();
				return ready;
			})));
			if (ready.every(Boolean) && !signal.aborted && !this.destroyed && preparationVersion === this.preparationVersion) {
				this.preparedContext = context;
			}
		} finally {
			waitController.abort();
		}
	}

	private getRequestedOutputIds(context: VisualModuleRenderContext): readonly string[] {
		return context.outputIds ?? (this.primaryOutputId == null ? [] : [this.primaryOutputId]);
	}

	private renderOutputs(context: VisualModuleRenderContext, commandEncoder: GPUCommandEncoder): Map<string, NodeOutput> {
		const outputs = new Map<string, NodeOutput>();
		if (this.destroyed || this.renderNodeId == null) return outputs;
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
			visited: new Set<VisualModuleNode['id']>(),
			rendered: new Set<VisualModuleNode['id']>(),
		});

		for (const id of this.getRequestedOutputIds(context)) {
			const value = this.getOutputValue(node, id);
			if (value != null) outputs.set(id, value);
		}
		return outputs;
	}

	public render(context: VisualModuleRenderContext, commandEncoder: GPUCommandEncoder): NodeOutput | undefined {
		const outputs = this.renderOutputs(context, commandEncoder);
		return this.primaryOutputId == null ? undefined : outputs.get(this.primaryOutputId);
	}

	public resize(resolution: Resolution, resolutionScale = 1) {
		this.resolutionScale = resolutionScale;
		this.contextResolution = scaleResolution(resolution, resolutionScale);
		this.preparedContext = null;
		++this.preparationVersion;
		this.effectCacheKeys.clear();
		// 実際にサイズが変わったノードだけ、次の準備・描画でリソースを更新する。
	}

	public destroy() {
		this.destroyed = true;
		this.preparedContext = null;
		++this.preparationVersion;
		for (const renderer of this.effectRenderers.values()) renderer.dispose();
		this.effectRenderers.clear();
		this.effectCacheKeys.clear();
		this.lazyEffectRenderers.clear();
		this.usedOutputPorts.clear();
	}
}
