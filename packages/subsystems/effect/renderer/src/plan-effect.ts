import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
import { scaleResolution } from '@gs/shared/resolution.ts';
import { resolveEffectNodeResolution } from '@gs/subsystems_effect_shared/effect-node-resolution.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { canCoerceParameterDataType, coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { constantShaderInputComponents } from '@gs/shared/gpu/shader-input.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import { resolveEffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { getEffectIntrinsicResolution, type EffectStaticResourceContext } from './effect-static-settings.ts';
import { createGraphEvaluation, type ReadFrameValue } from './graph-evaluation.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { EffectRenderTiling } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EffectSource, EffectDefinitions, ResolvedEffect } from '@gs/subsystems_effect_shared/effect-source.ts';
import { isUnselectedGraphParameterReference, type CustomNodeGraphEffect, type CustomNodeGraphEffectEffectNode, type CustomNodeGraphEffectParameterBinding, type NodeOutputReference } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { CustomNodeGraphEffectValueUpdate, EffectParameterInput, EffectTextureOutput, EffectFrameContext, EffectPreparationStatus } from './effect-instance.ts';

/** テクスチャを借用して転送する経路では、サンプリングを省略できる。 */
export type EffectPlacementInput = EffectParameterInput<EffectTextureOutput & { readonly sampling?: Readonly<ShaderInputSampling> }>;

const defaultEffectInputSampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } as const satisfies ShaderInputSampling;

export interface EffectPlacement {
	readonly effectSource: EffectSource;
	readonly definitions: EffectDefinitions;
	readonly resolution: Resolution;
	readonly resolutionScale?: number;
	readonly resolutionSetting?: EffectResolution;
	/** 素材一覧と準備済みテクスチャは呼び出し側から借用し、配置の寿命中固定する。 */
	readonly resources?: EffectStaticResourceContext;
	/** 保存した音声指定は呼び出し側が解釈する。取得元の未指定・未提供は未接続として扱う。 */
	readonly tiling?: EffectRenderTiling;
	/** 配置ID列とGPU時間（ms）。timestamp-query非対応時はnull。 */
	readonly onGpuTime?: (nodePath: readonly string[], passIndex: number, milliseconds: number | null) => void;
	/** フレームの全Effectパスの合計（ms）。パスがなければ0、計測できなかったパスがあればnull。 */
	readonly onFrameGpuTime?: (frame: EffectFrameContext, result: Promise<number | null>) => void;
	readonly onPreparationStatus?: (status: EffectPreparationStatus) => void;
	readonly usedOutputPorts: ReadonlySet<string>;
	readonly params?: Readonly<Record<string, ValueParameterBinding>>;
	readonly automationGraphs?: readonly AutomationGraph[];
	readonly inputs?: Readonly<Record<string, EffectPlacementInput>>;
	readonly staticSettings?: StaticSettingValues;
	/** 式・キー等の評価器はBindingごとに一度選ぶ。スコープは配置を識別するノードID列で区別する。 */
	readonly bindParameterValue?: (binding: ValueParameterBinding, definition: ParameterDefinition, nodePath: readonly string[]) => (frame: EffectFrameContext) => unknown;
}

interface PlannedInput<Input extends EffectPlacementInput = EffectPlacementInput> {
	readonly input: Input;
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

export type EvaluateStep = { readonly active: boolean; evaluate: (frame: EffectFrameContext) => void };
type RenderStep = PlannedEffectRenderer | EvaluateStep;
type ResolvePort = (port: string) => PlannedInput | null;
type ResolveEffectOutput = (port: string) => PlannedInput<EffectTextureOutput> | null;
type ObserveBinding = (update: (binding: CustomNodeGraphEffectParameterBinding) => boolean) => void;
type EvaluatedBinding = Exclude<CustomNodeGraphEffectParameterBinding, { inputSource: 'node' | 'customNodeGraphEffectPublicParameterReference' }>;

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
	return { use: source.use, input: textureInputWithSampling(input, sampling) };
}

function textureInputWithSampling<Sampling extends Readonly<ShaderInputSampling> | undefined>(input: EffectTextureOutput, sampling: Sampling) {
	return {
		kind: input.kind, resolution: input.resolution, sampling,
		get texture() { return input.texture; },
		get version() { return input.version; },
	};
}

// 公開ポートやBypassでは借用元の出力を転送する。描画するEffectに渡す段階でだけ
// 配列・構造体内の接続も含めてサンプリングを確定し、描画時に最新のテクスチャと世代を読めるようにする。
function resolveInputSampling(input: EffectPlacementInput): EffectParameterInput {
	switch (input.kind) {
		case 'texture': return textureInputWithSampling(input, { ...(input.sampling ?? defaultEffectInputSampling) });
		case 'array': return { kind: 'array', elements: input.elements.map(resolveInputSampling) };
		case 'struct': return { kind: 'struct', fields: Object.fromEntries(Object.entries(input.fields).map(([key, field]) => [key, resolveInputSampling(field)])) };
		default: return input;
	}
}

function textureOutput(source: PlannedInput | null): PlannedInput<EffectTextureOutput> | null {
	return source?.input.kind === 'texture' ? { input: source.input, use: source.use } : null;
}

function largestInputResolution(input: EffectPlacementInput, largest: Resolution | null): Resolution | null {
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
	const graphValueUpdates = new Map<string | null, ((change: CustomNodeGraphEffectValueUpdate) => boolean)[]>();
	let preparationLayoutRevision = 0;
	type Evaluation = {
		graph: () => ReturnType<typeof createGraphEvaluation>;
		resolution: () => Resolution;
		publicParameterDefs?: CustomNodeGraphEffect['paramDefs'];
	};

	function planBinding(definition: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding | null | undefined,
		publicInput: (id: string) => PlannedInput, nodeOutput: (reference: NodeOutputReference) => PlannedInput | null,
		path: readonly string[], evaluation: Evaluation, observe: ObserveBinding | null = null, isDefault = binding == null): PlannedInput {
		binding ??= createDefaultParameterBinding(definition);
		if (isUnselectedGraphParameterReference(binding)) {
			binding = createDefaultParameterBinding(definition);
			observe = null;
			isDefault = true;
		}
		if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			const source = publicInput(binding.parameterId);
			const input = source.input;
			if (input.kind === 'value') {
				const sourceDefinition = evaluation.publicParameterDefs?.[binding.parameterId];
				if (sourceDefinition != null && canCoerceParameterDataType(sourceDefinition.dataType, definition.dataType)) {
					// 参照元の文字列は保持し、受け取り側で変換する。子グラフがPUBLICで読む場合も同じ変換を通す。
					return {
						input: valueInput(definition, () => coerceParameterValue(definition, input.value)),
						use: source.use,
						prepareRead() {
							const read = prepareCpuReader(source);
							return frame => coerceParameterValue(definition, read(frame));
						},
					};
				}
				if (definition.canNode === true) return { input: valueInput(definition, () => input.value), use: source.use, prepareRead: source.prepareRead };
			}
			return withSampling(source, binding.sampling);
		}
		if (binding.inputSource === 'node') {
			// 配線は値評価に先立ち、保存されたBindingから解決する。入力のない場合は定義の初期値を使う。
			const source = binding.source == null ? null : nodeOutput(binding.source);
			if (source != null) return withSampling(source, binding.sampling);
			binding = createDefaultParameterBinding(definition);
			observe = null;
			isDefault = true;
		}
		if (binding.inputSource === 'literal') {
			const literal = binding;
			// 要素の並びとフィールドは配置中固定。編集時も同じ位置のBindingを各末端に渡す。
			const observeParent = observe;
			const child = (def: ParameterDefinition, select: (parent: typeof literal) => CustomNodeGraphEffectParameterBinding) => planBinding(
				def, select(literal), publicInput, nodeOutput, path, evaluation,
				observeParent == null ? null : update => observeParent(next => update(select(next as typeof literal))), isDefault);
			if (isParameterType(definition, 'array')) {
				const elementDefinition = getArrayElementDefinition(definition);
				const elements = (literal.value as ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[]).map((_, index) => child(elementDefinition, parent => parent.value[index].binding));
				return {
					input: { kind: 'array', elements: elements.map(element => element.input) },
					use: deps => elements.forEach(element => element.use?.(deps)),
					prepareRead() {
						const readers = elements.map(prepareCpuReader);
						return frame => readers.map(read => read(frame));
					},
				};
			}
			if (isParameterType(definition, 'struct')) {
				const fields = Object.entries(getStructFieldDefinitions(definition)).map(([key, def]) => [key, child(def, parent => parent.value[key])] as const);
				return {
					input: { kind: 'struct', fields: Object.fromEntries(fields.map(([key, field]) => [key, field.input])) },
					use: deps => fields.forEach(([, field]) => field.use?.(deps)),
					prepareRead() {
						const readers = fields.map(([key, field]) => [key, prepareCpuReader(field)] as const);
						return frame => Object.fromEntries(readers.map(([key, read]) => [key, read(frame)]));
					},
				};
			}
			if (observe == null && definition.dataType.kind !== 'audioSource' && isDefault) {
				// 末端までliteralなので、既定色のpremultiplyなども初期化時の一度で済む。
				return { input: definition.canNode === true
					? { kind: 'uniform', value: constantShaderInputComponents(definition.dataType.kind, literal.value) }
					: { kind: 'value', value: literal.value } };
			}
			if (observe == null && definition.dataType.kind !== 'audioSource' && literal.expressionModifier?.enabled !== true) {
				return { input: valueInput(definition, () => literal.value) };
			}
		}

		let selected: EvaluatedBinding = binding;
		let value: unknown;
		let components: readonly number[] = [];
		let read: ReadFrameValue | null = null;
		let lastFrame: EffectFrameContext | null = null;
		let used = false;

		function setValue(next: unknown) {
			value = next;
			if (definition.canNode === true) components = constantShaderInputComponents(definition.dataType.kind, next);
		}

		function bindValue(source: EvaluatedBinding): ReadFrameValue | null {
			if (source.inputSource === 'literal' && definition.dataType.kind === 'audioSource') {
				setValue(null);
				return null;
			}
			if (source.inputSource === 'literal' && source.expressionModifier?.enabled !== true) {
				setValue(source.value);
				return null;
			}
			setValue(definition.defaultValue);
			if (source.inputSource === 'customNodeGraphEffectCustomParameterValueReference') {
				const graph = evaluation.graph();
				return frame => graph.readCustom(source.parameterId, frame);
			}
			if (placement.bindParameterValue != null) return placement.bindParameterValue(source, definition, path);
			const graph = evaluation.graph();
			const scope = graph.nodeScope(contextResolution, evaluation.resolution());
			const evaluate = getEvaluator().bind(source, definition.defaultValue, definition, graph.automationGraphs);
			return frame => evaluate(scope(frame));
		}

		function activate() {
			if (used) return;
			used = true;
			read = bindValue(selected);
		}

		const step: EvaluateStep = {
			get active() { return read != null; },
			evaluate(frame) {
				if (read == null || lastFrame === frame) return;
				setValue(read(frame));
				lastFrame = frame;
			},
		};
		observe?.(next => {
			if (deepEqual(selected, next)) return false;
			// 入力方式・配線の変更は配置を再生成するので、この末端には同じ構造の値だけが届く。
			selected = next as EvaluatedBinding;
			if (!used) return false;
			const wasActive = step.active;
			read = bindValue(selected);
			lastFrame = null;
			if (step.active !== wasActive) preparationLayoutRevision++;
			return true;
		});
		return {
			input: definition.canNode === true ? { kind: 'uniform', get value() { return components; } } : { kind: 'value', get value() { return value; } },
			use(deps) { activate(); if (step.active || observe != null) deps.add(step); },
			prepareRead() {
				activate();
				return frame => { step.evaluate(frame); return value; };
			},
		};
	}

	function planPlacement(source: EffectSource, effect: ResolvedEffect, bind: (id: string, nodeResolution: () => Resolution) => PlannedInput, baseResolution: () => Resolution,
		setting: Resolution | EffectResolution | null, staticSettings: StaticSettingValues, path: readonly string[], bypass = false): ResolveEffectOutput {
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

		// 描画や値評価を始める前に、静的設定の参照先と配線から実際の出力寸法を確定する。
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
			const { primaryInputParameter, primaryOutput, paramDefs, outputDefs } = effect.definition;
			if (primaryInputParameter == null || primaryOutput == null
				|| !areNodeDataTypesCompatible(outputDefs[primaryOutput]?.dataType, getNodeInputDataType(paramDefs[primaryInputParameter]))) {
				return () => null;
			}
			// Bypassは主入力の画像を借用する。副出力を参照しても主入力の描画は起動しない。
			return id => id === primaryOutput ? textureOutput(parameter(primaryInputParameter)) : null;
		}

		if (effect.type === 'customNodeGraphEffect') {
			const graph = effect.definition;
			let scope: ReturnType<typeof createGraphEvaluation> | null = null;
			let customParameterValues = graph.customParameterValues;
			type NodeParams = CustomNodeGraphEffectEffectNode['params'];
			// 登録IDは複数の配置に対応する。nullは呼び出し元が直接所有するルートのインライン定義に限る。
			const acceptsValueUpdates = source.type === 'customNodeGraphEffectReference' || path.length === 0;
			const nodeValueUpdates = new Map<string, (params: NodeParams) => boolean>();
			if (acceptsValueUpdates) {
				const id = source.type === 'customNodeGraphEffectReference' ? source.id : null;
				let updates = graphValueUpdates.get(id);
				if (updates == null) graphValueUpdates.set(id, updates = []);
				updates.push(change => {
					if ('nodeId' in change) return nodeValueUpdates.get(change.nodeId)?.(change.params) ?? false;
					customParameterValues = change.customParameterValues;
					return scope?.updateCustomParameterValues(customParameterValues) ?? false;
				});
			}

			function graphScope() {
				if (scope == null) {
					scope = createGraphEvaluation({ ...graph, customParameterValues }, getEvaluator(), id => prepareCpuReader(parameter(id)));
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
						// Relayは入力を借用して中継する。描画とテクスチャの所有権は配線元に残る。
						const input = node.input == null ? null : 'parameterId' in node.input ? parameter(node.input.parameterId) : nodeOutput(node.input);
						placements.set(node.id, () => input);
						return input;
					}
					const child = resolveEffectSource(node.effectSource, placement.definitions);
					const childPath = [...path, node.id];
					let params = node.params;
					const updateBindings: ((params: NodeParams) => boolean)[] = [];
					if (acceptsValueUpdates) nodeValueUpdates.set(node.id, next => {
						params = next;
						let affected = false;
						for (const update of updateBindings) if (update(params)) affected = true;
						return affected;
					});
					const childInput = (id: string, nodeResolution: () => Resolution) => {
						const def = child.definition.paramDefs[id];
						let defaultBinding: ReturnType<typeof createDefaultParameterBinding> | null = null;
						const read = (bindings: NodeParams) => bindings[id] ?? (defaultBinding ??= createDefaultParameterBinding(def));
						return planBinding(def, read(params), parameter, nodeOutput, childPath,
							{ graph: graphScope, resolution: nodeResolution, publicParameterDefs: graph.paramDefs },
							acceptsValueUpdates ? update => updateBindings.push(next => update(read(next))) : null, params[id] == null);
					};
					resolve = planPlacement(node.effectSource, child, childInput, getResolution, node.resolution ?? null, node.staticSettings ?? {}, childPath, node.isBypass);
					placements.set(node.id, resolve);
				}
				return resolve(reference.outputPort);
			}

			return id => {
				const source = graph.outputSources[id];
				if (source == null) return null;
				// Relayを含めて配線を解決した後、テクスチャを持つ配置だけがOutから出力する。
				return textureOutput('parameterId' in source ? parameter(source.parameterId) : nodeOutput(source));
			};
		}

		const renderer: PlannedEffectRenderer = {
			effect, resolution: getResolution(), inputs: Object.create(null),
			staticSettings: settings, path, version: 0,
			bindOutputTextures: new Map(), dependencies: new Set(),
		};
		const ports = new Map<string, PlannedInput<EffectTextureOutput>>();
		return id => {
			const existing = ports.get(id);
			if (existing != null) return existing;
			// 計画中は種別・寸法だけで配線できる。履歴の書き込み先が交替しても、このポートから最新の結果を読める。
			let texture: GPUTexture;
			const port: PlannedInput<EffectTextureOutput> = {
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
						renderer.inputs[key] = resolveInputSampling(source.input);
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
	const resolve = planPlacement(placement.effectSource, root, (id, resolution) => {
		const input = placement.inputs?.[id];
		const def = root.definition.paramDefs[id];
		return input != null ? { input } : planBinding(def, placement.params?.[id], noParent, noParent, [], { graph: rootScope, resolution });
	}, () => contextResolution, placement.resolutionSetting ?? { mode: 'context', scale: 1 }, placement.staticSettings ?? {}, []);
	const outputs = new Map<string, EffectTextureOutput>();
	const roots = new Set<RenderStep>();
	for (const id of placement.usedOutputPorts) {
		const source = resolve(id);
		if (source == null) continue;
		source.use?.(roots);
		outputs.set(id, source.input);
	}
	// 後から要求されたポートが追加の上流を使う場合がある。全ポートの依存が揃ってから一度だけ描画順を決める。
	const ordered = new Set<RenderStep>();

	function append(step: RenderStep): void {
		if (ordered.has(step)) return;
		if ('dependencies' in step) for (const dependency of step.dependencies) append(dependency);
		ordered.add(step);
	}

	// 値編集で初めて式修飾子が有効になると、PUBLICを読むための親側の入力が追加で必要になる。
	function bindPublicValues() {
		for (const bind of bindScopes) bind();
		bindScopes.clear();
	}

	for (const step of roots) append(step);
	bindPublicValues();
	const valueUpdates = {
		get preparationLayoutRevision() { return preparationLayoutRevision; },
		apply(id: string | null, change: CustomNodeGraphEffectValueUpdate) {
			const updates = graphValueUpdates.get(id);
			if (updates == null) return false;
			let affected = false;
			for (const update of updates) if (update(change)) affected = true;
			bindPublicValues();
			return affected;
		},
		clear() { graphValueUpdates.clear(); },
	};
	return { steps: ordered, outputs, contextResolution, resources, valueUpdates };
}
