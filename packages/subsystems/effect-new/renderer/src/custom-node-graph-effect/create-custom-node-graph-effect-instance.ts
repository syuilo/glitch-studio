import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { createResolutionExpressionVariables } from '@gs/shared/expression/resolution-variables.ts';
import type { ExpressionEnvironment } from '@gs/shared/expression/expression-environment.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { resolveEffectNodeResolution } from '@gs/subsystems_effect-new_shared/resolution.ts';
import { createCustomNodeGraphEffectParameterEvaluator } from '../custom-node-graph-effect-parameters.ts';
import { createDefaultEffectInput, createLiteralBindingInput, createLiteralEffectInput } from '../effect-input.ts';
import { canReadPublicParameterInExpression } from './public-parameter.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode, CustomNodeGraphEffectNode, CustomNodeGraphEffectOutputConnection, CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect/types.ts';
import type { ResolvedEffect } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectEnvironment, EffectInstance, EffectInstanceOptions, EffectOutput, EffectParameterInput, EffectTextureOutput } from '../effect-instance.ts';

type CreateLeafInstance = (effect: Exclude<ResolvedEffect, { type: 'customNodeGraphEffect' }>, options: EffectInstanceOptions) => Promise<EffectInstance<EffectTextureOutput>>;
type InputPlan = () => EffectParameterInput;
type OutputPlan = () => EffectOutput | null;
type TraceOutput = (id: string) => OutputPlan;
const DISCONNECTED: OutputPlan = () => null;

// 配線をたどる段階では、到達したNative Effectの使用出力がまだ増える可能性がある。
// 接続先のインスタンス・出力種別を読むのは、全要求を集約し、上流を初期化してから。
function once<T>(initialize: () => T): () => T {
	let value: T;
	let pending: (() => T) | null = initialize;
	return () => {
		if (pending != null) {
			value = pending();
			// 式から寸法を継続して読む場合も、初期化時のノードや配線マップを保持しない。
			pending = null;
		}
		return value;
	};
}

function disposeInstances(instances: EffectInstance[]): void {
	// 下流が上流のテクスチャを借用するため、作成順の逆順に解放する。
	for (let i = instances.length - 1; i >= 0; i--) instances[i].dispose();
	instances.length = 0;
}

// 実行時に必要なのは出力と平坦な描画列だけ。計画用のクロージャをスコープごと切り離す。
function createRenderSequence(outputs: Record<string, EffectOutput>, instances: EffectInstance[]): EffectInstance {
	return {
		outputs,
		render(frame) {
			for (const instance of instances) instance.render(frame);
		},
		dispose: () => disposeInstances(instances),
	};
}

// 評価器は公開入力の読み取り口を準備中に解決する。式が保持するスコープに
// ノードの配線・親の計画を引き継がないよう、ここでは事前に選ばれた引数だけを渡す。
function parameterEvaluator(graph: CustomNodeGraphEffect, inputs: ReadonlyMap<string, InputPlan>, environment: EffectEnvironment) {
	const { paramDefs, customParameterDefs, customParameterValues, automationGraphs } = graph;
	return createCustomNodeGraphEffectParameterEvaluator({ paramDefs, customParameterDefs, customParameterValues, automationGraphs },
		id => inputs.get(id)!(), environment);
}

// 同じ公開ポートへ複数の配線が合流しても、親子のグラフを跨ぐ探索は配置・ポートごとに一度で済む。
function cacheOutputPlans(trace: TraceOutput): TraceOutput {
	const outputs = new Map<string, OutputPlan>();
	return id => {
		let plan = outputs.get(id);
		if (plan == null) {
			plan = trace(id);
			outputs.set(id, plan);
		}
		return plan;
	};
}

function largestInputResolution(input: EffectParameterInput, largest: Resolution | null): Resolution | null {
	if (input.kind === 'texture') {
		const resolution = input.resolution;
		return largest == null || resolution.width * resolution.height > largest.width * largest.height ? resolution : largest;
	}
	if (input.kind === 'array') {
		for (const element of input.elements) largest = largestInputResolution(element, largest);
	}
	if (input.kind === 'struct') {
		for (const field of Object.values(input.fields)) largest = largestInputResolution(field, largest);
	}
	return largest;
}

/** 検証済みの配線を受け取る。出力要求をグラフ境界の先まで追跡し、配置ごとの描画列に平坦化する。 */
export async function createCustomNodeGraphEffectInstance(customNodeGraphEffect: CustomNodeGraphEffect, options: EffectInstanceOptions,
	environment: EffectEnvironment, createLeafInstance: CreateLeafInstance,
	getRootInput: (id: string) => EffectParameterInput = id => options.inputs[id]): Promise<EffectInstance> {
	const initializers: (() => Promise<EffectInstance>)[] = [];
	const expressionInputsByScope: Map<string, InputPlan>[] = [];

	function planGraph(graph: CustomNodeGraphEffect, publicInput: (id: string) => InputPlan, contextResolution: () => Resolution): TraceOutput {
		const nodes = new Map(graph.nodes.map(node => [node.id, node]));
		const outputNode = graph.nodes.find(node => node.type === 'globalOut');
		// 同じ登録済み定義の別配置は別のスコープ・履歴を持つ。このマップをグラフ定義間で共有しない。
		const tracePerPlacement = new Map<string, TraceOutput>();
		const expressionInputs = new Map<string, InputPlan>();
		const evaluateBinding = once(() => {
			expressionInputsByScope.push(expressionInputs);
			return parameterEvaluator(graph, expressionInputs, environment);
		});

		function tracePublicParameter(id: string): void {
			if (!expressionInputs.has(id)) expressionInputs.set(id, publicInput(id));
		}

		const traceExpressionParameters = once(() => {
			// PUBLICの名前は式で計算できる。CPU値だけは候補を先に計画し、値は式で要求されたときに読む。
			for (const definition of graph.paramDefs) {
				if (canReadPublicParameterInExpression(definition)) tracePublicParameter(definition.id);
			}
		});

		function traceConnection(connection: CustomNodeGraphEffectOutputConnection | undefined): OutputPlan {
			if (connection?.nodeId == null || connection.outputPort == null) return DISCONNECTED;
			const node = nodes.get(connection.nodeId)!;
			let trace = tracePerPlacement.get(node.id);
			if (trace == null) {
				trace = cacheOutputPlans(planNode(node));
				tracePerPlacement.set(node.id, trace);
			}
			return trace(connection.outputPort);
		}

		function planParameter(definition: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding, placementVariables: ExpressionEnvironment['variables']): InputPlan {
			if (binding.inputSource === 'literal' && definition.dataType.kind === 'array') {
				const elementDefinition = getArrayElementDefinition(definition);
				const plans = (binding.value as ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[]).map(element =>
					planParameter(elementDefinition, element.binding, placementVariables));
				return () => ({ kind: 'array', elements: plans.map(plan => plan()) });
			}
			if (binding.inputSource === 'literal' && definition.dataType.kind === 'struct') {
				const fields = Object.entries(getStructFieldDefinitions(definition)).map(([key, field]) =>
					[key, planParameter(field, binding.value[key], placementVariables)] as const);
				return () => ({ kind: 'struct', fields: Object.fromEntries(fields.map(([key, plan]) => [key, plan()])) });
			}
			if (binding.inputSource === 'literal' && binding.expressionModifier?.enabled !== true) {
				return () => createLiteralBindingInput(definition, binding.value, environment.resolveAudioSource);
			}
			if (binding.inputSource === 'node') {
				if (binding.nodeId == null) return () => createLiteralEffectInput(definition, null);
				const getOutput = traceConnection(binding);
				// サンプリング設定は値を読む接続が所有する。公開入力・relayを通るだけではコピーも描画もしない。
				const sampling = { fitMode: binding.fitMode, wrapMode: binding.wrapMode, filterMode: binding.filterMode };
				return () => {
					const output = getOutput();
					return output == null ? createLiteralEffectInput(definition, null) : { ...output, sampling };
				};
			}
			if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference' && binding.parameterId !== '') {
				tracePublicParameter(binding.parameterId);
			}
			if (binding.inputSource === 'expression' || binding.inputSource === 'customNodeGraphEffectCustomParameterValueReference'
				|| ('expressionModifier' in binding && binding.expressionModifier?.enabled === true)) traceExpressionParameters();
			return () => evaluateBinding()(definition, binding, placementVariables);
		}

		function planEffectNode(node: CustomNodeGraphEffectEffectNode): TraceOutput {
			const effect = resolveEffectSource(node.effectSource, environment.catalog);
			if (node.isBypass) {
				const primary = effect.definition.primaryInputParameter;
				const binding = primary == null ? null : node.params[primary];
				const output = binding?.inputSource === 'node' ? traceConnection(binding) : DISCONNECTED;
				return () => output;
			}
			const inputPlans = new Map<string, InputPlan>();
			// auto解像度を決めるには入力の種類が先に必要。入力の式はこの変数表を捕捉し、
			// 寸法確定時に一度だけ埋めることで、評価中のサイズ計画への再入を避ける。
			const placementVariables: ExpressionEnvironment['variables'] = {};
			const staticSettings = createStaticSettingValues(effect.definition.staticSettingDefs ?? {}, node.staticSettings);
			const getResolution = once((): Resolution => {
				let largest: Resolution | null = null;
				const intrinsic = effect.type === 'nativeEffect' && effect.definition.intrinsicResolutionSetting != null && node.resolution.mode === 'auto'
					? environment.getIntrinsicResolution?.(effect.definition, staticSettings) : null;
				if (intrinsic == null && node.resolution.mode === 'auto') {
					for (const id of effect.definition.resolutionInputParameters) largest = largestInputResolution(inputPlans.get(id)!(), largest);
				}
				const resolution = resolveEffectNodeResolution({ setting: node.resolution, contextResolution: contextResolution(),
					resolutionScale: environment.resolutionScale ?? 1, intrinsicResolution: intrinsic, inputResolution: largest,
					maxDimension: options.gpu.device.limits.maxTextureDimension2D });
				Object.assign(placementVariables, createResolutionExpressionVariables(resolution));
				return resolution;
			});

			function traceInput(id: string): InputPlan {
				let plan = inputPlans.get(id);
				if (plan == null) {
					const definition = effect.definition.paramDefs[id];
					const binding = node.params[id];
					plan = once(binding == null
						? () => createDefaultEffectInput(definition, environment.resolveAudioSource)
						: planParameter(definition, binding, placementVariables));
					inputPlans.set(id, plan);
				}
				return plan;
			}

			if (effect.type === 'customNodeGraphEffect') {
				// 子の要求出力へ到達する公開入力だけが親の配線へ戻ってくる。
				// 公開入力を直接転送する配置にも固有の寸法がある。子ノードがなくても、
				// 配置パラメータの式が初回描画で解像度計画に入らないよう先に解決する。
				getResolution();
				return planGraph(effect.customNodeGraphEffect, traceInput, getResolution);
			}
			const inputs = Object.keys(effect.definition.paramDefs).map(id => [id, traceInput(id)] as const);
			const usedOutputPorts = new Set<string>();
			let instance: EffectInstance<EffectTextureOutput>;
			// 上流の初期化処理はtraceInputで先に登録済み。後続からの各出力要求は同じSetへ集約する。
			initializers.push(async () => {
				instance = await createLeafInstance(effect, { gpu: options.gpu, resolution: getResolution(), usedOutputPorts,
					inputs: Object.fromEntries(inputs.map(([id, plan]) => [id, plan()])), staticSettings });
				return instance;
			});
			return id => {
				usedOutputPorts.add(id);
				return () => instance.outputs[id] ?? null;
			};
		}

		function planNode(node: CustomNodeGraphEffectNode): TraceOutput {
			switch (node.type) {
				case 'globalIn': return id => {
					const getInput = publicInput(id);
					return () => {
						const input = getInput();
						return input.kind === 'texture' || input.kind === 'uniform' ? input : null;
					};
				};
				case 'globalOut': return id => traceConnection(node.inputs[id]);
				case 'relay': {
					const output = traceConnection(node.input);
					return () => output;
				}
				case 'effect': return planEffectNode(node);
			}
		}

		return id => traceConnection(outputNode?.inputs[id]);
	}

	const traceOutput = planGraph(customNodeGraphEffect, id => () => getRootInput(id), () => options.resolution);
	const outputPlans = Array.from(options.usedOutputPorts, id => [id, traceOutput(id)] as const);
	const instances: EffectInstance[] = [];
	try {
		for (const initialize of initializers) instances.push(await initialize());
		const outputs: Record<string, EffectOutput> = Object.create(null);
		for (const [id, materialize] of outputPlans) {
			const output = materialize();
			if (output != null) outputs[id] = output;
		}
		for (const inputs of expressionInputsByScope) inputs.clear();
		return createRenderSequence(outputs, instances);
	} catch (error) {
		disposeInstances(instances);
		throw error;
	}
}
