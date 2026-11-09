import { normalizedToSpatialCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { scaleResolution, type Resolution } from '@gs/shared/resolution.ts';
import { createResolutionExpressionVariables } from '@gs/shared/expression/resolution-variables.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { visualModulePublicParameterId, type VisualModulePublicParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import { constantShaderInput, toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import { genEmptyValue } from '@gs/shared/parameter/parameter-default.ts';
import { VisualModuleParameterBindingEvaluator } from './visual-module-parameter-binding-evaluator.ts';
import { VisualModuleCustomParameterEvaluator } from './visual-module-custom-parameter-evaluator.ts';
import { validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { EffectRenderer } from '@gs/subsystems_effect_renderer/effect-renderer.ts';
import { resolveVisualModuleResolutions } from './visual-module-resolutions.ts';
import { resolveVisualModuleOutputSource } from './visual-module-output-source.ts';
import { getEffectIntrinsicResolution, resolveEffectStaticResources } from '@gs/subsystems_effect_renderer/effect-static-settings.ts';
import { resolveEffectParameterValue } from '@gs/subsystems_effect_renderer/effect-parameter-value.ts';
import { getEvaluatedParameterValue, mapParameterTree, walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import defaultVertexShaderCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type TimingHelper from '@gs/shared/gpu/TimingHelper.ts';
import type { VisualModuleEvaluatedParameterValues } from '@gs/subsystems_visual-module_shared/parameter-evaluation.ts';
import type { VisualModuleParameterEvaluationContext } from './visual-module-parameter-binding-evaluator.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { VideoFrameTexture } from '@gs/shared/media/video-texture.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { VisualModuleEffectNode, VisualModuleNode, VisualModule, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectImplementation, EffectRenderContext } from '@gs/subsystems_effect_shared/effect-implementation.js';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.js';
import type { IN_VISUAL_MODULE_VAR_DEFS } from '@gs/subsystems_visual-module_shared/expression.ts';

type VisualModuleNodeRenderRequest = { renderer: EffectRenderer; context: Omit<EffectRenderContext, 'commandEncoder' | 'outputDataMap' | 'createPassEncoderFor' | 'createPassEncoder' | 'createComputePassEncoder'> };

const NO_OUTPUT_PORTS: ReadonlySet<string> = new Set();

export type VisualModuleRenderContext = {
	isExport: boolean;
	// 省略時はタイムライン・プレビュー用の主出力だけを評価する。
	outputIds?: readonly string[];
	//globalTime: number; // タイムラインの再生位置を示すが、使わなそう
	time: number;
	timeDelta: number;
	endTime: number; // 終了時刻という概念がないコンテキスト(例: Visual Module Live Preview)の場合はInfinityとすること。
	/** 内容時刻と独立した表示区間の進行率。タイムラインの呼び出し側で計算する。 */
	progress?: number;
	paramInputs?: ReadonlyMap<VisualModulePublicParameterId, UniformOrTexture>;
	audioParamInputs?: ReadonlyMap<VisualModulePublicParameterId, AudioInput | null>;
	/** プレビューからの各軸[-1,+1]の位置。両軸<=-999は未入力の予約値。 */
	pointerPosition: { x: number; y: number };
	/** pointerPositionと同じ画像参照座標で測った前回位置。 */
	pointerPositionPrev: { x: number; y: number };
	evaluatedParamValues: VisualModuleEvaluatedParameterValues;
};

type EvaluatedVisualModuleEffectNode = {
	params: Record<string, any>;
	pointerContext: Pick<EffectRenderContext, 'pointerPosition' | 'pointerVector'>;
};

export class VisualModuleRenderer {
	private gpuDevice: GPUDevice;
	private defaultVertexShaderModule: GPUShaderModule;
	private fallbackTexture: GPUTexture;
	/** 呼び出し側から与えられた描画基準。倍率適用済みで、個々のノード寸法とは異なる。 */
	private contextResolution: Resolution;
	private resolutionScale: number;
	private nodeResolutions = new Map<string, Resolution>();
	private inputResolutions: ReadonlyMap<string, Resolution | null>;
	private getPlayerResolution: ((playerId: string) => Resolution | null) | null;
	private nodes: VisualModuleNode[] = [];
	private paramDefs: VisualModule['paramDefs'];
	private customParameterDefs: VisualModule['customParameterDefs'];
	private customParameterValues: VisualModule['customParameterValues'];
	private outputDefs: VisualModule['outputDefs'] = [];
	private primaryOutputId: string | null = null;
	private primaryInputId: VisualModulePublicParameterId | null = null;
	private paramValues: VisualModuleEvaluatedParameterValues = new Map();
	private paramInputs: ReadonlyMap<VisualModulePublicParameterId, UniformOrTexture> = new Map();
	private audioParamInputs: ReadonlyMap<VisualModulePublicParameterId, AudioInput | null> = new Map();
	private resolvedAudioInputs = new Map<string, AudioInput | null>();
	private resolveAudioSource: ((selection: unknown) => AudioInput | null) | null = null;
	private preparedContext: VisualModuleRenderContext | null = null;
	private pendingPreparation: { context: VisualModuleRenderContext; renderers: EffectRenderer[] } | null = null;
	private preparationVersion = 0;
	private destroyed = false;
	private allNodeIdMap: Map<VisualModuleNode['id'], VisualModuleNode> = new Map(); // モジュール内のノードをIDで解決する。
	private evaluatedEffectNodes = new Map<VisualModuleEffectNode['id'], EvaluatedVisualModuleEffectNode>();
	private effectRenderers = new Map<string, EffectRenderer>();
	private effectCacheKeys: Map<VisualModuleEffectNode['id'], string> = new Map();
	private lazyEffectRenderers = new Map<string, EffectRenderer>();
	private usedOutputPorts = new Map<string, Set<string>>();
	private onEffectState: ((nodeId: string, state: EffectInstanceState | null) => void) | null = null;
	private automationGraphs: AutomationGraph[] = [];
	private enable32bitDataTextures = false;
	private readonly getPlayerVideoTexture: (playerId: string) => VideoFrameTexture | null;
	private readonly videoFrameVersions: ReadonlyMap<string, number>;
	private readonly assetTextures: ReadonlyMap<string, GPUTexture>;
	private readonly assets: readonly Asset[];
	private timingHelper: TimingHelper | null;
	private enableStats = true;
	private renderNodeId: VisualModuleNode['id'] | null = null;
	private effectDefinitions: Record<string, EffectDefinition>;
	private effectImplementations: Record<string, EffectImplementation<any>>;
	private readonly effectRenderTileDivisionLevel: number;
	private tiledRenderController: AbortController | null = null;
	public lastTiledGpuTime = 0;
	private parameterEvaluator = new VisualModuleParameterBindingEvaluator();

	constructor(options: {
		onEffectState?: (nodeId: string, state: EffectInstanceState | null) => void;
		enableStats: boolean;
		effectRenderTileDivisionLevel?: number;
		timingHelper: TimingHelper | null;
		gpuDevice: GPUDevice;
		fallbackTexture: GPUTexture;
		resolution: Resolution;
		resolutionScale?: number;
		inputResolutions?: ReadonlyMap<string, Resolution | null>;
		getPlayerResolution?: (playerId: string) => Resolution | null;
		enable32bitDataTextures: boolean;
		getPlayerVideoTexture?: (playerId: string) => VideoFrameTexture | null;
		videoFrameVersions: ReadonlyMap<string, number>;
		/** 素材一覧とテクスチャはインスタンスの寿命中に変更しない。GPUへの準備完了後に渡す。 */
		assets: readonly Asset[];
		visualModule: VisualModule;
		assetTextures: ReadonlyMap<string, GPUTexture>;
		/** 静的な音声指定の解釈は呼び出し側が所有する。未提供の取得元は未接続とする。 */
		resolveAudioSource?: (selection: unknown) => AudioInput | null;
		effectDefinitions: Record<string, EffectDefinition>;
		effectImplementations: Record<string, EffectImplementation<any>>;
	}) {
		this.effectRenderTileDivisionLevel = options.effectRenderTileDivisionLevel ?? 0;
		this.inputResolutions = options.inputResolutions ?? new Map();
		this.getPlayerResolution = options.getPlayerResolution ?? null;
		this.gpuDevice = options.gpuDevice;
		this.fallbackTexture = options.fallbackTexture;
		this.paramDefs = options.visualModule.paramDefs;
		this.customParameterDefs = options.visualModule.customParameterDefs;
		this.customParameterValues = options.visualModule.customParameterValues;
		this.onEffectState = options.onEffectState ?? null;
		this.enableStats = options.enableStats;
		this.resolutionScale = options.resolutionScale ?? 1;
		this.contextResolution = scaleResolution(options.resolution, this.resolutionScale);
		this.enable32bitDataTextures = options.enable32bitDataTextures;
		this.getPlayerVideoTexture = options.getPlayerVideoTexture ?? (() => null);
		this.videoFrameVersions = options.videoFrameVersions;
		this.assetTextures = options.assetTextures;
		this.assets = options.assets;
		this.resolveAudioSource = options.resolveAudioSource ?? null;
		this.timingHelper = options.timingHelper;
		this.effectDefinitions = options.effectDefinitions;
		this.effectImplementations = options.effectImplementations;
		this.defaultVertexShaderModule = this.gpuDevice.createShaderModule({
			code: defaultVertexShaderCode,
		});
		this.updateVisualModule(options.visualModule);
	}

	public updateVisualModule(visualModule: VisualModule, options: {
		/** 通常パラメータの値だけを編集した場合に指定する。 */
		preserveStaticState?: boolean;
		inputResolutions?: ReadonlyMap<string, Resolution | null>;
	} = {}) {
		this.tiledRenderController?.abort();
		this.automationGraphs = visualModule.automationGraphs;
		this.outputDefs = visualModule.outputDefs;
		this.primaryOutputId = visualModule.primaryOutputId;
		this.primaryInputId = visualModule.primaryInputId;
		this.paramDefs = visualModule.paramDefs;
		this.customParameterDefs = visualModule.customParameterDefs;
		this.customParameterValues = visualModule.customParameterValues;
		// 公開定義と入力寸法を同じスナップショットとして取り込み、仮の寸法で出力を確保しない。
		if (options.preserveStaticState !== true) this.inputResolutions = new Map(options.inputResolutions ?? this.inputResolutions);
		this.paramValues = new Map();
		this.paramInputs = new Map();
		this.updateNodes(visualModule.nodes, options.preserveStaticState === true);
	}

	private getParamOutput(paramId: VisualModulePublicParameterId): UniformOrTexture | null {
		const def = this.paramDefs.find(def => def.id === paramId);
		if (def == null || !def.canNode) return null;
		const input = this.paramInputs.get(paramId);
		if (input != null) return input;
		const value = this.paramValues.get(paramId);
		return constantShaderInput(def.dataType.kind, value);
	}

	private evaluateParameters(context: VisualModuleRenderContext) {
		this.paramInputs = context.paramInputs ?? new Map();
		this.audioParamInputs = context.audioParamInputs ?? new Map();
		this.resolvedAudioInputs = new Map();
		// モジュール内部の式から直接参照できるのはcanNode: falseのパラメータだけ。
		// canNode: trueは定数でもInノード経由で読み、定数／テクスチャで参照方法を変えない。
		// Inノード用の評価済み値は保持し、式へ渡す値と参照名だけを絞り込む。
		const expressionParamDefs = this.paramDefs.filter(def => !def.canNode && def.dataType.kind !== 'audioSource');

		// 式の位置とPointer Trailが同じ単位になるよう、各評価対象の描画領域で換算する。
		// 未入力の予約値は座標ではないため維持する。
		const pointerPositionFor = (resolution: Resolution) => context.pointerPosition.x <= -999 && context.pointerPosition.y <= -999
			? [context.pointerPosition.x, context.pointerPosition.y]
			: normalizedToSpatialCoordinates([context.pointerPosition.x, context.pointerPosition.y], resolution);
		const normalizedPointerVector: [number, number] = [
			context.pointerPositionPrev.x === -99999 ? 0 : context.pointerPosition.x - context.pointerPositionPrev.x,
			context.pointerPositionPrev.y === -99999 ? 0 : context.pointerPosition.y - context.pointerPositionPrev.y,
		];
		const evalCtx = {
			variables: {
				TIME: context.time / 1000,
				TIME_MS: context.time,
				END_TIME: context.endTime / 1000,
				END_TIME_MS: context.endTime,
				PROGRESS: context.progress ?? context.time / context.endTime,
				IS_EXPORT: context.isExport,
				TEST_ONLY_VM: true,
				TEST_SAME_NAME: 1,
			},
			automationGraphs: this.automationGraphs,
			time: context.time,
			endTime: context.endTime,
			evaluatedParamValues: new Map(expressionParamDefs.filter(def => context.evaluatedParamValues.has(def.id))
				.map(def => [def.id, context.evaluatedParamValues.get(def.id)])),
			paramIdsByName: new Map(expressionParamDefs.map(def => [def.nameForReference, def.id])),
		} satisfies VisualModuleParameterEvaluationContext;
		const customParameters = new VisualModuleCustomParameterEvaluator({ paramDefs: this.paramDefs,
			customParameterDefs: this.customParameterDefs, customParameterValues: this.customParameterValues }, evalCtx, this.parameterEvaluator);

		const evaluated = new Map<VisualModuleEffectNode['id'], EvaluatedVisualModuleEffectNode>();
		for (const node of this.nodes.filter((n): n is VisualModuleEffectNode => n.type === 'effect')) {
			const resolution = this.nodeResolutions.get(node.id)!;
			// 式の評価と実際の描画で同じ換算結果を使い、EffectRendererへは
			// プレビュー固有の画像参照座標やその変換規則を持ち込まない。
			const pointerPosition = pointerPositionFor(resolution);
			const pointerVector = normalizedToSpatialCoordinates(normalizedPointerVector, resolution);
			const pointerContext = {
				pointerPosition: { x: pointerPosition[0], y: pointerPosition[1] },
				pointerVector: { x: pointerVector[0], y: pointerVector[1] },
			};
			const nodeEvalCtx = {
				...evalCtx,
				customParameters,
				variables: {
					...evalCtx.variables,
					...createResolutionExpressionVariables(resolution),
					POINTER_POSITION: pointerPosition,
				} satisfies Record<typeof IN_VISUAL_MODULE_VAR_DEFS[number], unknown>,
			};
			const paramDefs = this.effectDefinitions[node.effectId].paramDefs;
			const evaluatedParamsPerNode = {} as Record<string, any>;
			for (const [key, def] of Object.entries(paramDefs)) {
				if (node.isBypass && key !== this.effectDefinitions[node.effectId].primaryInputParameter) continue;
				evaluatedParamsPerNode[key] = mapParameterTree<VisualModuleParameterBinding>(def, node.params[key], [key], (def, param) => {
					if (def.dataType.kind === 'audioSource' && param.inputSource === 'visualModulePublicParameterReference') return null;
					// 未選択は定義の初期値へ戻す。選択済みIDの欠落・型違いは評価側で報告し、初期値で隠さない。
					const binding = param.inputSource === 'visualModuleCustomParameterValueReference' && param.parameterId === '' ? def.defaultValue : param;
					return coerceParameterValue(def, validateEnumParameterValue(def, this.parameterEvaluator.evaluate(binding, nodeEvalCtx,
						def.dataType.kind === 'enum' ? null : genEmptyValue(def), def))); // TODO: genEmptyValueを遅延評価したい
				});
			}
			evaluated.set(node.id, { params: evaluatedParamsPerNode, pointerContext });
		}

		this.paramValues = context.evaluatedParamValues;
		this.evaluatedEffectNodes = evaluated;
	}

	private evalCacheKey(node: VisualModuleNode, outputPort?: string | null): string | null {
		if (node.type === 'globalIn') {
			// 定数は値でキャッシュできる。借用テクスチャは同一オブジェクトでも内容が変わり得る。
			// 別の公開入力の値変更を、このポートだけを読む枝へ伝播させない。
			const ids = outputPort == null ? Object.keys(getNodeOutputs(node, this.paramDefs, this.effectDefinitions)) : [outputPort];
			const outputs = ids.map(id => this.getParamOutput(visualModulePublicParameterId(id)));
			return outputs.some(output => output?.kind === 'texture') ? null : JSON.stringify([node.id, ids, outputs]);
		}
		if (node.type === 'globalOut') return null;

		let key = node.type === 'relay' ? `node=${node.id};type=relay;` : `node=${node.id};isBypass=${node.isBypass};`;

		if (node.type === 'relay' || node.isBypass) {
			// 出力に寄与しない入力やdisableCacheには依存しない。
			// 出力元のIDもキーに含め、同じパラメータの別ノードへの切り替えを検出する。
			const output = this.getOutputNode(node);
			if (output == null) return `${key}output=none;`;
			const outputKey = this.evalCacheKey(output.node, output.outputPort);
			return outputKey == null ? null : `${key}port=${output.outputPort};output=${outputKey};`;
		} else {
			if (this.effectImplementations[node.effectId].disableCache) { // TODO: 廃止(cacheVersionに一本化)
				return null;
			}
			// 解像度・静的設定の変更はresourceVersionへ反映されるため、設定値自体は含めない。
			// 非同期準備の完了はcacheVersionで後続ノードへ伝播させる。
			const renderer = this.effectRenderers.get(node.id)!;
			key += `cacheVersion=${renderer.cacheVersion};resources=${renderer.resourceVersion};`;
			// 出力の利用開始・停止でも、依存先を含めキャッシュを更新する。
			if (renderer.hasLazyOutputs) key += `ports=${JSON.stringify([...(this.usedOutputPorts.get(node.id) ?? [])].sort())};`;

			const paramDefs = this.effectDefinitions[node.effectId].paramDefs;

			const params = this.evaluatedEffectNodes.get(node.id)!.params;
			// 空配列・空structや要素数の変化もキーに含める。
			key += JSON.stringify(params);
			for (const [setting, definition] of Object.entries(this.effectDefinitions[node.effectId].staticSettingDefs ?? {})) {
				if (definition.dataType.kind !== 'playerReference') continue;
				const playerId = node.staticSettings[setting];
				key += JSON.stringify([setting, typeof playerId === 'string' ? this.videoFrameVersions.get(playerId) ?? 0 : 0]);
			}
			for (const { def, param, path } of walkParameterLeaves<VisualModuleParameterBinding>(paramDefs, node.params)) {
				const v = getEvaluatedParameterValue(params, path);
				key += JSON.stringify([path, param.inputSource]);
				if (param.inputSource === 'node' && param.nodeId != null) {
					key += JSON.stringify([param.fitMode, param.wrapMode, param.filterMode]);
				}
				// 外部から渡されたテクスチャは同じオブジェクトの内容が毎フレーム変わり得る。
				if (def.canNode && param.inputSource === 'visualModulePublicParameterReference') {
					const input = this.paramInputs.get(param.parameterId);
					if (input?.kind === 'texture') return null;
					key += JSON.stringify(input);
				}

				if (def.dataType.kind === 'audioSource') key += JSON.stringify([path, this.resolveAudioInput(node.id, path, param, v)?.cacheKey ?? null]);
				if (def.canNode && param.inputSource === 'node' && param.nodeId != null) {
					const targetNode = this.allNodeIdMap.get(param.nodeId);
					const targetNodeCacheKey = this.evalCacheKey(targetNode!, param.outputPort ?? null);
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
			resolvedParams[key] = mapParameterTree<VisualModuleParameterBinding>(def, node.params[key], [key], (def, param, path) => {
				const v = getEvaluatedParameterValue(params, path);
				if (def.dataType.kind === 'audioSource') return this.resolveAudioInput(node.id, path, param, v);

				if (def.canNode && param.inputSource === 'node' && param.nodeId != null) {
					const output = this.getOutputValue(this.allNodeIdMap.get(param.nodeId)!, param.outputPort);
					return output == null ? constantShaderInput(def.dataType.kind, null) : toShaderInput(output, param);
				}
				return resolveEffectParameterValue(def, v);
			});
		}
		return resolvedParams;
	}

	private resolveAudioInput(nodeId: string, path: readonly (string | number)[], binding: VisualModuleParameterBinding, value: unknown): AudioInput | null {
		const key = JSON.stringify([nodeId, path]);
		if (this.resolvedAudioInputs.has(key)) return this.resolvedAudioInputs.get(key)!;
		let input: AudioInput | null = null;
		if (binding.inputSource === 'visualModulePublicParameterReference' && this.audioParamInputs.has(binding.parameterId)) {
			input = this.audioParamInputs.get(binding.parameterId)!;
		} else {
			const selection = binding.inputSource === 'visualModulePublicParameterReference'
				? this.paramValues.get(binding.parameterId) ?? this.paramDefs.find(def => def.id === binding.parameterId)?.defaultValue.value ?? null : value;
			if (selection != null) input = this.resolveAudioSource?.(selection) ?? null;
		}
		this.resolvedAudioInputs.set(key, input);
		return input;
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
			for (const { def, param } of walkParameterLeaves<VisualModuleParameterBinding>(this.effectDefinitions[output.node.effectId].paramDefs, output.node.params)) {
				if (!def.canNode || param.inputSource !== 'node' || param.nodeId == null) continue;
				const source = this.allNodeIdMap.get(param.nodeId);
				if (source != null) visit(source, param.outputPort ?? null);
			}
		};
		for (const id of outputIds) visit(node, id);
		// 描画順によらず必要なポートを先に集め、同じノードは1回の描画で全需要を満たす。
		for (const [id, renderer] of this.lazyEffectRenderers) {
			renderer.setUsedOutputPorts(this.usedOutputPorts.get(id) ?? NO_OUTPUT_PORTS);
		}
	}

	// (非workerで)呼び出すときはnewNodesを独立した参照にすること！ パフォーマンス上の理由でこちら側ではdeepCloneしません
	public updateNodes(newNodes: VisualModuleNode[], preserveStaticState = false) {
		if (this.destroyed) return;
		this.tiledRenderController?.abort();
		this.invalidatePreparation();
		// 保存済みスナップショットを変更せず、解像度・資源・キャッシュが同じ補完済み設定を使う。
		this.nodes = newNodes.map(node => node.type === 'effect' ? {
			...node,
			staticSettings: createStaticSettingValues(this.effectDefinitions[node.effectId].staticSettingDefs ?? {}, node.staticSettings),
		} : node);
		this.allNodeIdMap = new Map(this.nodes.map(node => [node.id, node]));
		// 値の編集でもBindingは最新スナップショットへ置き換えるが、静的な計画・
		// リソース・出力ノードは変わらないため、全ノードの再計画と再作成を省く。
		if (preserveStaticState) return;
		this.recreateEffectRenderers();
		this.renderNodeId = this.nodes.find(node => node.type === 'globalOut')?.id ?? null;
	}

	/** 静的設定・配線・描画基準の変更は、確定した解像度で全エフェクトを作り直す。 */
	private recreateEffectRenderers() {
		try {
			this.recomputeResolutions();
			// 新旧の出力を同時に保持せず、非同期準備・履歴・キャッシュもまとめて破棄する。
			for (const renderer of this.effectRenderers.values()) renderer.dispose();
			this.effectRenderers.clear();
			this.lazyEffectRenderers.clear();
			this.usedOutputPorts.clear();
			this.effectCacheKeys.clear();
			for (const node of this.nodes.filter(node => node.type === 'effect')) {
				const renderer = new EffectRenderer({
					definition: this.effectDefinitions[node.effectId],
					implementation: this.effectImplementations[node.effectId],
					resolution: this.nodeResolutions.get(node.id)!,
					staticResources: this.resolveStaticResources(node),
					wgpu: {
						device: this.gpuDevice,
						defaultVertexShaderModule: this.defaultVertexShaderModule,
						enable32bitDataTextures: this.enable32bitDataTextures,
					},
					fallbackTexture: this.fallbackTexture,
					enableStats: this.enableStats,
					effectRenderTileDivisionLevel: this.effectRenderTileDivisionLevel,
					timingHelper: this.timingHelper,
					onState: state => this.onEffectState?.(node.id, state),
				});
				this.effectRenderers.set(node.id, renderer);
				if (renderer.hasLazyOutputs) this.lazyEffectRenderers.set(node.id, renderer);
			}
		} catch (error) {
			// 生成途中のグラフを公開せず、確保済みの出力と待機も解放する。
			// 復旧は所有者がVisualModuleRendererを再生成して行う。
			this.destroy();
			throw error;
		}
	}

	// relayと無効なエフェクトは入力をそのまま公開する。テクスチャの所有権や履歴は元のノードに残す。
	// 描画・入力参照・キャッシュが同じ接続関係を扱うよう、ここで共通して解決する。
	private getOutputNode(node: VisualModuleNode, outputPort?: string | null) {
		return resolveVisualModuleOutputSource({
			nodes: this.allNodeIdMap, paramDefs: this.paramDefs, outputDefs: this.outputDefs,
			primaryInputId: this.primaryInputId, primaryOutputId: this.primaryOutputId,
			effectDefinitions: this.effectDefinitions,
		}, node, outputPort);
	}

	private getOutputValue(node: VisualModuleNode, outputPort: string): UniformOrTexture | null {
		const output = this.getOutputNode(node, outputPort);
		if (output == null) return null;
		if (output.node.type === 'globalIn') return this.getParamOutput(visualModulePublicParameterId(output.outputPort));
		const texture = this.effectRenderers.get(output.node.id)?.getOutputTexture(output.outputPort);
		return texture == null ? null : { kind: 'texture', texture };
	}

	private *renderNode(node: VisualModuleNode, context: VisualModuleRenderContext & {
		rendered: Set<VisualModuleNode['id']>;
	}): Generator<VisualModuleNodeRenderRequest, void> {
		if (node.type === 'globalIn') return;
		if (node.type === 'globalOut') {
			for (const id of this.getRequestedOutputIds(context)) {
				const output = this.getOutputNode(node, id);
				if (output != null) yield* this.renderNode(output.node, context);
			}
			return;
		}
		if (context.rendered.has(node.id)) { // キャッシュが無効だったとしても同じフレーム内に同じノードを複数回レンダリングするのは無駄(というかping-pongするエフェクトなら結果がおかしくなる)なため弾く
			return;
		}

		if (node.type === 'relay' || node.isBypass) {
			// relayとバイパスは自身を描画せず、解決した入力だけを更新する。
			// バイパスの切り替えは静的更新として扱い、描画履歴も再作成する。
			const output = this.getOutputNode(node);
			if (output == null) return;
			return yield* this.renderNode(output.node, {
				...context,
				rendered: context.rendered,
			});
		}

		const { params, pointerContext } = this.evaluatedEffectNodes.get(node.id)!;

		for (const { def, param } of walkParameterLeaves<VisualModuleParameterBinding>(this.effectDefinitions[node.effectId].paramDefs, node.params)) {
			if (!def.canNode || param.inputSource !== 'node' || param.nodeId == null) continue;
			const targetNode = this.allNodeIdMap.get(param.nodeId);
			yield* this.renderNode(targetNode!, {
				...context,
				rendered: context.rendered,
			});
		}

		const resolvedParams = this.resolveParams(node, params);
		this.effectRenderers.get(node.id)!.initialize(resolvedParams);
		// 初期化で変化するcacheVersionも反映してからキャッシュを判定する。
		const key = this.evalCacheKey(node);
		if (key != null && key === this.effectCacheKeys.get(node.id)) {
			context.rendered.add(node.id);
			return;
		}

		const renderer = this.effectRenderers.get(node.id)!;
		yield { renderer, context: {
			time: context.time / 1000,
			timeDelta: context.timeDelta,
			...pointerContext,
			params: resolvedParams,
			usedOutputPorts: this.usedOutputPorts.get(node.id),
		} };
		context.rendered.add(node.id);
		if (key != null) this.effectCacheKeys.set(node.id, key);
		else this.effectCacheKeys.delete(node.id);
	}

	private resolveStaticResources(node: VisualModuleEffectNode) {
		return resolveEffectStaticResources(this.effectDefinitions[node.effectId], node.staticSettings, {
			assets: this.assets, assetTextures: this.assetTextures,
			getPlayerVideoTexture: this.getPlayerVideoTexture,
		});
	}

	private recomputeResolutions() {
		this.nodeResolutions = resolveVisualModuleResolutions({
			visualModule: { nodes: this.nodes, paramDefs: this.paramDefs, outputDefs: this.outputDefs, primaryInputId: this.primaryInputId, primaryOutputId: this.primaryOutputId },
			effectDefinitions: this.effectDefinitions,
			contextResolution: this.contextResolution, resolutionScale: this.resolutionScale,
			maxDimension: this.gpuDevice.limits.maxTextureDimension2D,
			inputResolutions: this.inputResolutions,
			getIntrinsicResolution: node => getEffectIntrinsicResolution(this.effectDefinitions[node.effectId], node.staticSettings, {
				assets: this.assets, getPlayerResolution: playerId => this.getPlayerResolution?.(playerId) ?? null,
			}),
		});
	}

	private invalidatePreparation() {
		this.preparedContext = null;
		this.pendingPreparation = null;
		++this.preparationVersion;
	}

	// 同期の確認と非同期の待機で、入力評価・依存するエフェクトの準備を同じ順序で行う。
	private prepareEffects(context: VisualModuleRenderContext, signal?: AbortSignal): EffectRenderer[] {
		this.preparedContext = null;
		const node = this.renderNodeId == null ? null : this.allNodeIdMap.get(this.renderNodeId);
		if (node == null) return [];

		this.evaluateParameters(context);
		this.prepareOutputPorts(node, this.getRequestedOutputIds(context));

		const prepared = new Map<string, EffectRenderer>();

		const visit = (target: VisualModuleNode, port?: string) => {
			if (prepared.has(target.id)) return;
			const output = this.getOutputNode(target, port);
			if (output == null || output.node.type === 'globalIn') return;
			const effectNode = output.node;
			if (prepared.has(effectNode.id)) return;
			for (const { def, param } of walkParameterLeaves<VisualModuleParameterBinding>(this.effectDefinitions[effectNode.effectId].paramDefs, effectNode.params)) {
				if (!def.canNode || param.inputSource !== 'node' || param.nodeId == null) continue;
				const source = this.allNodeIdMap.get(param.nodeId);
				visit(source!, param.outputPort ?? null);
			}
			const params = this.resolveParams(effectNode, this.evaluatedEffectNodes.get(effectNode.id)!.params);
			const renderer = this.effectRenderers.get(effectNode.id)!;
			renderer.prepare(params, signal);
			prepared.set(effectNode.id, renderer);
		};

		for (const id of this.getRequestedOutputIds(context)) {
			visit(node, id);
		}
		return [...prepared.values()];
	}

	/** 同じcontextでは入力評価を維持して準備の完了だけを確認する。履歴は進めない。 */
	public tryPrepare(context: VisualModuleRenderContext): boolean {
		if (this.destroyed) return false;
		if (this.pendingPreparation?.context !== context) {
			this.invalidatePreparation();
			this.pendingPreparation = { context, renderers: this.prepareEffects(context) };
		}
		let ready = true;
		for (const renderer of this.pendingPreparation.renderers) {
			// 準備中の枝があっても全て確認し、別の枝の失敗をそのまま通知する。
			if (!renderer.checkReady()) ready = false;
		}
		if (ready) this.preparedContext = context;
		return ready;
	}

	// 描画せずに初期化・パラメータ変更の準備を行い、履歴を余分に進めない。
	public async prepare(context: VisualModuleRenderContext, signal: AbortSignal): Promise<void> {
		if (signal.aborted || this.destroyed) return;
		this.invalidatePreparation();
		const preparationVersion = this.preparationVersion;
		const prepared = this.prepareEffects(context, signal);

		// 各エフェクトの準備は先に開始し、待機だけをまとめる。失敗時には他の待機も
		// 終了させるが、エフェクト自体は破棄せず、次の要求でリソース・履歴を再利用する。
		const waitController = new AbortController();
		const waitSignal = AbortSignal.any([signal, waitController.signal]);
		try {
			const ready = await Promise.all(prepared.map(renderer => renderer.waitUntilReady(waitSignal).then(ready => {
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

	private *renderOutputNodes(context: VisualModuleRenderContext): Generator<VisualModuleNodeRenderRequest, Map<string, UniformOrTexture>> {
		const outputs = new Map<string, UniformOrTexture>();
		if (this.destroyed || this.renderNodeId == null) return outputs;
		const node = this.allNodeIdMap.get(this.renderNodeId);
		if (node == null) return outputs;

		// 準備時と同じ評価結果を使い、同じフレームで式を重複評価しない。
		if (this.preparedContext !== context) {
			this.evaluateParameters(context);
		}
		this.invalidatePreparation();

		this.prepareOutputPorts(node, this.getRequestedOutputIds(context));

		yield* this.renderNode(node, {
			...context,
			rendered: new Set<VisualModuleNode['id']>(),
		});

		for (const id of this.getRequestedOutputIds(context)) {
			const value = this.getOutputValue(node, id);
			if (value != null) outputs.set(id, value);
		}
		return outputs;
	}

	private renderOutputs(context: VisualModuleRenderContext, commandEncoder: GPUCommandEncoder): Map<string, UniformOrTexture> {
		const evaluation = this.renderOutputNodes(context);
		let step = evaluation.next();
		while (!step.done) {
			step.value.renderer.render({ ...step.value.context, commandEncoder });
			step = evaluation.next();
		}
		return step.value;
	}

	public render(context: VisualModuleRenderContext, commandEncoder: GPUCommandEncoder): UniformOrTexture | null {
		const outputs = this.renderOutputs(context, commandEncoder);
		return this.primaryOutputId == null ? null : outputs.get(this.primaryOutputId) ?? null;
	}

	/** 同期経路と同じ走査を、エフェクト単位のGPU完了境界で進める。 */
	public async renderTiled(context: VisualModuleRenderContext, signal?: AbortSignal): Promise<UniformOrTexture | null> {
		if (this.tiledRenderController != null) throw new Error('Visual Module tiled render is already running.');
		const controller = new AbortController();
		this.tiledRenderController = controller;
		const renderSignal = signal == null ? controller.signal : AbortSignal.any([controller.signal, signal]);
		const evaluation = this.renderOutputNodes(context);
		this.lastTiledGpuTime = 0;
		try {
			renderSignal.throwIfAborted();
			let step = evaluation.next();
			while (!step.done) {
				this.lastTiledGpuTime += await step.value.renderer.renderTiled(step.value.context, renderSignal);
				renderSignal.throwIfAborted();
				step = evaluation.next();
			}
			return this.primaryOutputId == null ? null : step.value.get(this.primaryOutputId) ?? null;
		} catch (error) {
			// 上流が部分更新された可能性もあるので、以前の静的キャッシュを流用しない。
			this.effectCacheKeys.clear();
			throw error;
		} finally {
			evaluation.return(new Map());
			this.tiledRenderController = null;
		}
	}

	public resize(resolution: Resolution, resolutionScale = 1) {
		if (this.destroyed) return;
		this.tiledRenderController?.abort();
		const contextResolution = scaleResolution(resolution, resolutionScale);
		// contextの寸法が同じでも倍率が変われば素材原寸・customAbsoluteの計画は変わる。
		// 同じ描画基準の再通知だけは、履歴や非同期準備を失わないようにする。
		if (this.resolutionScale === resolutionScale && this.contextResolution.width === contextResolution.width
			&& this.contextResolution.height === contextResolution.height) return;
		this.resolutionScale = resolutionScale;
		this.contextResolution = contextResolution;
		this.invalidatePreparation();
		this.recreateEffectRenderers();
	}

	public resetRenderHistory() {
		if (this.destroyed) return;
		this.tiledRenderController?.abort();
		this.invalidatePreparation();
		for (const [id, renderer] of this.effectRenderers) {
			const node = this.allNodeIdMap.get(id)!;
			if (node.type === 'effect' && this.effectDefinitions[node.effectId].dependsOnRenderHistory) renderer.resetRenderHistory();
		}
		// 履歴の変化が下流の静的ノードへも反映されるよう、描画結果のキーを破棄する。
		this.effectCacheKeys.clear();
	}

	public destroy() {
		this.tiledRenderController?.abort();
		this.destroyed = true;
		this.invalidatePreparation();
		for (const renderer of this.effectRenderers.values()) renderer.dispose();
		this.effectRenderers.clear();
		this.effectCacheKeys.clear();
		this.lazyEffectRenderers.clear();
		this.usedOutputPorts.clear();
	}
}
