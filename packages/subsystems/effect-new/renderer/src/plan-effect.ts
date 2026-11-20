import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
import { scaleResolution } from '@gs/shared/resolution.ts';
import { resolveEffectNodeResolution } from '@gs/subsystems_effect-new_shared/effect-node-resolution.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { constantShaderInputComponents } from '@gs/shared/gpu/shader-input.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { getEffectIntrinsicResolution, type EffectStaticResourceContext } from './effect-static-settings.ts';
import { createGraphEvaluation, type ReadFrameValue } from './graph-evaluation.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { EffectRenderTiling } from '@gs/subsystems_effect-new_shared/effect-render-tiling.ts';
import type { EffectResolution } from '@gs/subsystems_effect-new_shared/resolution.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EffectSource, EffectDefinitions, ResolvedEffect } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { isUnselectedGraphParameterReference, type CustomNodeGraphEffectParameterBinding, type NodeOutputReference } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import type { EffectParameterInput, EffectImageInput, EffectFrameContext, EffectPreparationStatus } from './effect-instance.ts';

export interface EffectPlacement {
	readonly effectSource: EffectSource;
	readonly definitions: EffectDefinitions;
	readonly resolution: Resolution;
	readonly resolutionScale?: number;
	readonly resolutionSetting?: EffectResolution;
	readonly resources?: EffectStaticResourceContext;
	readonly resolveAudioSource?: (source: unknown, frame: EffectFrameContext) => AudioInput | null;
	readonly tiling?: EffectRenderTiling;
	/** 配置ID列とGPU時間（ms）。timestamp-query非対応時はnull。 */
	readonly onGpuTime?: (nodePath: readonly string[], passIndex: number, milliseconds: number | null) => void;
	readonly onPreparationStatus?: (status: EffectPreparationStatus) => void;
	readonly usedOutputPorts: ReadonlySet<string>;
	readonly params?: Readonly<Record<string, ValueParameterBinding>>;
	readonly automationGraphs?: readonly AutomationGraph[];
	readonly inputs?: Readonly<Record<string, EffectParameterInput>>;
	readonly staticSettings?: StaticSettingValues;
	/** 式・キー等の評価器はBindingごとに一度選ぶ。スコープは配置を識別するノードID列で区別する。 */
	readonly bindParameterValue?: (binding: ValueParameterBinding, definition: ParameterDefinition, nodePath: readonly string[]) => (frame: EffectFrameContext) => unknown;
}

interface PlannedInput {
	readonly input: EffectParameterInput;
	/** 寸法だけを問い合わせた依存は描画しない。実際に値を読む経路に限って順序へ追加する。 */
	readonly prepareRead?: () => ReadFrameValue;
	readonly use?: (dependencies: Set<RenderStep>) => void;
}

interface PlannedEffectRenderer {
	readonly effect: Exclude<ResolvedEffect, { type: 'customNodeGraphEffect' }>;
	readonly resolution: Resolution;
	readonly inputs: Record<string, EffectParameterInput>;
	readonly staticSettings: StaticSettingValues;
	readonly bindOutputTextures: Map<string, (texture: GPUTexture) => void>;
	readonly path: readonly string[];
	version: number;
	readonly dependencies: Set<RenderStep>;
}

type EvaluateStep = { evaluate: (frame: EffectFrameContext) => void };
type RenderStep = PlannedEffectRenderer | EvaluateStep;
type ResolvePort = (port: string) => PlannedInput | null;

function prepareCpuReader(source: PlannedInput): ReadFrameValue {
	if (source.prepareRead != null) return source.prepareRead();
	const input = source.input;
	if (input.kind === 'array') {
		const elements = input.elements.map(child => prepareCpuReader({ input: child }));
		return frame => elements.map(read => read(frame));
	}
	if (input.kind === 'struct') {
		const fields = Object.entries(input.fields).map(([key, child]) => [key, prepareCpuReader({ input: child })] as const);
		return frame => Object.fromEntries(fields.map(([key, read]) => [key, read(frame)]));
	}
	if (input.kind === 'value') return () => input.value;
	return () => { throw new Error('PUBLIC requires a CPU parameter'); };
}

function valueInput(definition: ParameterDefinition, read: () => unknown): EffectParameterInput {
	if (definition.canNode !== true) return { kind: 'value', get value() { return read(); } };
	return { kind: 'uniform', get value() { return constantShaderInputComponents(definition.dataType.kind, read()); } };
}

function withSampling(source: PlannedInput, sampling?: ShaderInputSampling): PlannedInput {
	const input = source.input;
	if (input.kind !== 'texture' || sampling === input.sampling) return source;
	return { use: source.use, input: { kind: 'texture', sampling, resolution: input.resolution, get texture() { return input.texture; }, get version() { return input.version; } } };
}

function largestInputResolution(input: EffectParameterInput, largest: Resolution | null): Resolution | null {
	if (input.kind === 'texture') {
		const size = input.resolution;
		if (largest == null || size.width * size.height > largest.width * largest.height) return size;
	} else if (input.kind === 'array' || input.kind === 'struct') {
		for (const child of input.kind === 'array' ? input.elements : Object.values(input.fields)) largest = largestInputResolution(child, largest);
	}
	return largest;
}

/** 入れ子の境界も初期化時にたどり切る。各配置が自身のポートを共有し、登録IDの同じ別配置とは共有しない。 */
export function planEffect(placement: EffectPlacement, maxDimension = Number.MAX_SAFE_INTEGER) {
	const scale = placement.resolutionScale ?? 1;
	const contextResolution = scaleResolution(placement.resolution, scale);
	const resources = placement.resources ?? { assets: [], assetTextures: new Map() };
	let evaluator: ParameterBindingEvaluator | null = null;
	const getEvaluator = () => evaluator ??= new ParameterBindingEvaluator(new ExpressionEvaluator());
	const bindScopes = new Set<() => void>();
	type Evaluation = { graph: () => ReturnType<typeof createGraphEvaluation>; resolution: () => Resolution };

	function planBinding(definition: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding,
		publicInput: (id: string) => PlannedInput, nodeOutput: (reference: NodeOutputReference) => PlannedInput | null,
		path: readonly string[], evaluation: Evaluation, isDefault = binding === definition.defaultValue): PlannedInput {
		if (isUnselectedGraphParameterReference(binding)) {
			binding = definition.defaultValue;
			isDefault = true;
		}
		if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			const source = publicInput(binding.parameterId);
			const input = source.input;
			if (definition.canNode === true && input.kind === 'value') return { input: valueInput(definition, () => input.value), use: source.use, prepareRead: source.prepareRead };
			return withSampling(source, binding.sampling);
		}
		if (binding.inputSource === 'node') {
			const source = binding.source == null ? null : nodeOutput(binding.source);
			if (source != null) return withSampling(source, binding.sampling);
			binding = definition.defaultValue;
			isDefault = true;
		}
		if (binding.inputSource === 'literal') {
			const literal = binding;
			const child = (def: ParameterDefinition, value: CustomNodeGraphEffectParameterBinding) => planBinding(def, value, publicInput, nodeOutput, path, evaluation, isDefault);
			if (definition.dataType.kind === 'array') {
				const elementDefinition = getArrayElementDefinition(definition);
				const elements = (literal.value as ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[]).map(element => child(elementDefinition, element.binding));
				return {
					input: { kind: 'array', elements: elements.map(element => element.input) },
					use: deps => elements.forEach(element => element.use?.(deps)),
					prepareRead() {
						const readers = elements.map(prepareCpuReader);
						return frame => readers.map(read => read(frame));
					},
				};
			}
			if (definition.dataType.kind === 'struct') {
				const fields = Object.entries(getStructFieldDefinitions(definition)).map(([key, def]) => [key, child(def, literal.value[key])] as const);
				return {
					input: { kind: 'struct', fields: Object.fromEntries(fields.map(([key, field]) => [key, field.input])) },
					use: deps => fields.forEach(([, field]) => field.use?.(deps)),
					prepareRead() {
						const readers = fields.map(([key, field]) => [key, prepareCpuReader(field)] as const);
						return frame => Object.fromEntries(readers.map(([key, read]) => [key, read(frame)]));
					},
				};
			}
			if (definition.dataType.kind === 'audioSource') {
				if (literal.value == null || placement.resolveAudioSource == null) return { input: { kind: 'value', value: null } };
				const resolve = placement.resolveAudioSource;
				let audio: AudioInput | null = null;
				const step = { evaluate(frame: EffectFrameContext) { audio = resolve(literal.value, frame); } };
				return { input: { kind: 'value', get value() { return audio; } }, use: deps => deps.add(step) };
			}
			if (isDefault) {
				// 末端までliteralなので、既定色のpremultiplyなども初期化時の一度で済む。
				return { input: definition.canNode === true
					? { kind: 'uniform', value: constantShaderInputComponents(definition.dataType.kind, literal.value) }
					: { kind: 'value', value: literal.value } };
			}
			if (literal.expressionModifier?.enabled !== true) return { input: valueInput(definition, () => literal.value) };
		}

		const dynamicBinding = binding;
		let value: unknown = definition.defaultValue.value;
		let step: EvaluateStep | null = null;

		function prepareStep(): EvaluateStep {
			if (step != null) return step;
			let evaluate: ReadFrameValue;
			if (dynamicBinding.inputSource === 'customNodeGraphEffectCustomParameterValueReference') {
				const graph = evaluation.graph();
				evaluate = frame => graph.readCustom(dynamicBinding.parameterId, frame);
			} else if (placement.bindParameterValue != null) {
				evaluate = placement.bindParameterValue(dynamicBinding, definition, path);
			} else {
				const graph = evaluation.graph();
				const scope = graph.nodeScope(contextResolution, evaluation.resolution());
				const read = getEvaluator().bind(dynamicBinding, definition.defaultValue.value, definition, graph.automationGraphs);
				evaluate = frame => read(scope(frame));
			}
			let lastFrame: EffectFrameContext | null = null;
			step = { evaluate(frame) {
				if (lastFrame === frame) return;
				value = evaluate(frame);
				lastFrame = frame;
			} };
			return step;
		}

		return {
			input: valueInput(definition, () => value),
			use: deps => deps.add(prepareStep()),
			prepareRead() {
				const evaluationStep = prepareStep();
				return frame => { evaluationStep.evaluate(frame); return value; };
			},
		};
	}

	function planPlacement(effect: ResolvedEffect, bind: (id: string, nodeResolution: () => Resolution) => PlannedInput, baseResolution: () => Resolution,
		setting: Resolution | EffectResolution | null, staticSettings: StaticSettingValues, path: readonly string[], bypass = false): ResolvePort {
		const inputs = new Map<string, PlannedInput>();

		function parameter(id: string): PlannedInput {
			let input = inputs.get(id);
			if (input == null) {
				input = bind(id, getResolution);
				// 公開画像はそのまま転送し、実際に画像を読む内部接続がFit/Wrap/Filterを所有する。
				if (effect.type === 'customNodeGraphEffect') input = withSampling(input);
				inputs.set(id, input);
			}
			return input;
		}

		const settings = createStaticSettingValues(effect.definition.staticSettingDefs ?? {}, staticSettings);
		let resolution: Resolution | null = null;

		function getResolution(): Resolution {
			if (resolution != null) return resolution;
			const selected = setting == null ? { mode: 'auto', scale: 1 } as const
				: 'mode' in setting ? setting : { mode: 'customAbsolute', ...setting } as const;
			const intrinsic = selected.mode === 'auto' ? getEffectIntrinsicResolution(effect.definition, settings, resources) : null;
			let inputSize: Resolution | null = null;
			if (selected.mode === 'auto' && intrinsic == null) {
				for (const id of effect.definition.resolutionInputParameters) inputSize = largestInputResolution(parameter(id).input, inputSize);
			}
			resolution = resolveEffectNodeResolution({
				setting: selected, resolutionScale: scale, maxDimension,
				contextResolution: baseResolution, intrinsicResolution: intrinsic, inputResolution: inputSize,
			});
			return resolution;
		}

		if (bypass) {
			const primary = effect.definition.primaryInputParameter;
			return () => primary == null ? null : parameter(primary);
		}

		if (effect.type === 'customNodeGraphEffect') {
			const graph = effect.definition;
			let scope: ReturnType<typeof createGraphEvaluation> | null = null;

			function graphScope() {
				if (scope == null) {
					scope = createGraphEvaluation(graph, getEvaluator(), id => prepareCpuReader(parameter(id)));
					bindScopes.add(scope.bindPublicValues);
				}
				return scope;
			}

			const nodes = new Map(graph.nodes.map(node => [node.id, node]));
			const placements = new Map<string, ResolvePort>();

			function nodeOutput(reference: NodeOutputReference): PlannedInput | null {
				let resolve = placements.get(reference.nodeId);
				if (resolve == null) {
					const node = nodes.get(reference.nodeId)!;
					if (node.type === 'relay') {
						const input = node.input == null ? null : 'parameterId' in node.input ? parameter(node.input.parameterId) : nodeOutput(node.input);
						placements.set(node.id, () => input);
						return input;
					}
					const child = resolveEffectSource(node.effectSource, placement.definitions);
					const childPath = [...path, node.id];
					const childInput = (id: string, nodeResolution: () => Resolution) => {
						const def = child.definition.paramDefs[id];
						return planBinding(def, node.params[id] ?? def.defaultValue, parameter, nodeOutput, childPath, { graph: graphScope, resolution: nodeResolution });
					};
					resolve = planPlacement(child, childInput, getResolution, node.resolution ?? null, node.staticSettings ?? {}, childPath, node.isBypass);
					placements.set(node.id, resolve);
				}
				return resolve(reference.outputPort);
			}

			return id => {
				const source = graph.outputSources[id];
				if (source == null) return null;
				return 'parameterId' in source ? parameter(source.parameterId) : nodeOutput(source);
			};
		}

		const renderer: PlannedEffectRenderer = {
			effect, resolution: getResolution(), inputs: Object.create(null),
			staticSettings: settings, path, version: 0,
			bindOutputTextures: new Map(), dependencies: new Set(),
		};
		const ports = new Map<string, PlannedInput>();
		return id => {
			const existing = ports.get(id);
			if (existing != null) return existing;
			// 計画中は種別・寸法だけで配線できる。履歴の書き込み先が交替しても、このポートから最新の結果を読める。
			let texture: GPUTexture;
			const port: PlannedInput = {
				input: { kind: 'texture', resolution: renderer.resolution, get texture() { return texture; }, get version() { return renderer.version; } },
				use(dependencies) {
					dependencies.add(renderer);
					if (renderer.bindOutputTextures.has(id)) return;
					const keys = effect.type === 'nativeEffect' ? effect.definition.outputDefs[id].inputParameters : null;
					for (const key of keys ?? Object.keys(effect.definition.paramDefs)) {
						if (Object.hasOwn(renderer.inputs, key)) continue;
						const source = parameter(key);
						if (effect.type === 'customShaderEffect' && source.input.kind !== 'uniform' && source.input.kind !== 'texture') {
							throw new Error('Custom Shader Effect input requires a fixed uniform or texture source: ' + key);
						}
						source.use?.(renderer.dependencies);
						renderer.inputs[key] = source.input;
					}
					renderer.bindOutputTextures.set(id, allocated => { texture = allocated; });
				},
			};
			ports.set(id, port);
			return port;
		};
	}

	const root = resolveEffectSource(placement.effectSource, placement.definitions);
	const noParent = (): never => { throw new Error('Effect defaults must be literal'); };
	let rootEvaluation: ReturnType<typeof createGraphEvaluation> | null = null;
	const rootScope = () => rootEvaluation ??= createGraphEvaluation({ paramDefs: {}, automationGraphs: placement.automationGraphs }, getEvaluator(), noParent);
	const resolve = planPlacement(root, (id, resolution) => {
		const input = placement.inputs?.[id];
		const def = root.definition.paramDefs[id];
		return input != null ? { input } : planBinding(def, placement.params?.[id] ?? def.defaultValue, noParent, noParent, [], { graph: rootScope, resolution });
	}, () => contextResolution, placement.resolutionSetting ?? { mode: 'context', scale: 1 }, placement.staticSettings ?? {}, []);
	const outputs = new Map<string, EffectImageInput>();
	const roots = new Set<RenderStep>();
	for (const id of placement.usedOutputPorts) {
		const source = resolve(id);
		if (source == null) continue;
		source.use?.(roots);
		outputs.set(id, source.input as EffectImageInput);
	}
	// 後から要求されたポートが追加の上流を使う場合がある。全ポートの依存が揃ってから一度だけ描画順を決める。
	const ordered = new Set<RenderStep>();

	function append(step: RenderStep): void {
		if (ordered.has(step)) return;
		if ('dependencies' in step) for (const dependency of step.dependencies) append(dependency);
		ordered.add(step);
	}

	for (const step of roots) append(step);
	for (const bind of bindScopes) bind();
	return { steps: ordered, outputs, contextResolution, resources };
}
