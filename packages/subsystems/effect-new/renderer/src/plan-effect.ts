import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { constantShaderInputComponents } from '@gs/shared/gpu/shader-input.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EffectSource, EffectDefinitions, ResolvedEffect } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { CustomNodeGraphEffectParameterBinding, NodeOutputReference } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';
import type { EffectParameterInput, EffectImageInput, EffectRenderContext } from './effect-instance.ts';

export interface EffectPlacement {
	readonly effectSource: EffectSource;
	readonly definitions: EffectDefinitions;
	readonly resolution: Resolution;
	readonly usedOutputPorts: ReadonlySet<string>;
	readonly inputs?: Readonly<Record<string, EffectParameterInput>>;
	readonly staticSettings?: StaticSettingValues;
	/** 式・キー等の評価器はBindingごとに一度選ぶ。スコープは配置を識別するノードID列で区別する。 */
	readonly bindParameterValue?: (binding: ValueParameterBinding, definition: ParameterDefinition, nodePath: readonly string[]) => (frame: EffectRenderContext) => unknown;
}

interface PlannedInput {
	readonly input: EffectParameterInput;
	/** 寸法だけを問い合わせた依存は描画しない。実際に値を読む経路に限って順序へ追加する。 */
	readonly use?: (dependencies: Set<RenderStep>) => void;
}

interface PlannedEffectRenderer {
	readonly effect: Exclude<ResolvedEffect, { type: 'customNodeGraphEffect' }>;
	readonly resolution: Resolution;
	readonly inputs: Record<string, EffectParameterInput>;
	readonly staticSettings: StaticSettingValues;
	readonly bindOutputTextures: Map<string, (texture: GPUTexture) => void>;
	readonly dependencies: Set<RenderStep>;
}

type EvaluateStep = { evaluate: (frame: EffectRenderContext) => void };
type RenderStep = PlannedEffectRenderer | EvaluateStep;
type ResolvePort = (port: string) => PlannedInput | null;

function valueInput(definition: ParameterDefinition, read: () => unknown): EffectParameterInput {
	if (definition.canNode !== true) return { kind: 'value', get value() { return read(); } };
	return { kind: 'uniform', get value() { return constantShaderInputComponents(definition.dataType.kind, read()); } };
}

function withSampling(source: PlannedInput, sampling?: ShaderInputSampling): PlannedInput {
	const input = source.input;
	if (input.kind !== 'texture' || sampling === input.sampling) return source;
	return { use: source.use, input: { kind: 'texture', sampling, resolution: input.resolution, get texture() { return input.texture; } } };
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
export function planEffect(placement: EffectPlacement) {
	function planBinding(definition: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding,
		publicInput: (id: string) => PlannedInput, nodeOutput: (reference: NodeOutputReference) => PlannedInput | null,
		path: readonly string[], isDefault = binding === definition.defaultValue): PlannedInput {
		if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
			const source = publicInput(binding.parameterId);
			const input = source.input;
			if (definition.canNode === true && input.kind === 'value') return { input: valueInput(definition, () => input.value), use: source.use };
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
			const child = (def: ParameterDefinition, value: CustomNodeGraphEffectParameterBinding) => planBinding(def, value, publicInput, nodeOutput, path, isDefault);
			if (definition.dataType.kind === 'array') {
				const elementDefinition = getArrayElementDefinition(definition);
				const elements = (literal.value as ParameterArrayElement<CustomNodeGraphEffectParameterBinding>[]).map(element => child(elementDefinition, element.binding));
				return { input: { kind: 'array', elements: elements.map(element => element.input) }, use: deps => elements.forEach(element => element.use?.(deps)) };
			}
			if (definition.dataType.kind === 'struct') {
				const fields = Object.entries(getStructFieldDefinitions(definition)).map(([key, def]) => [key, child(def, literal.value[key])] as const);
				return { input: { kind: 'struct', fields: Object.fromEntries(fields.map(([key, field]) => [key, field.input])) }, use: deps => fields.forEach(([, field]) => field.use?.(deps)) };
			}
			if (isDefault) {
				// 末端までliteralなので、既定色のpremultiplyなども初期化時の一度で済む。
				return { input: definition.canNode === true
					? { kind: 'uniform', value: constantShaderInputComponents(definition.dataType.kind, literal.value) }
					: { kind: 'value', value: literal.value } };
			}
			if (literal.expressionModifier?.enabled !== true) return { input: valueInput(definition, () => literal.value) };
		}

		let value: unknown = definition.defaultValue.value;
		let step: EvaluateStep | null = null;
		return {
			input: valueInput(definition, () => value),
			use(dependencies) {
				if (step == null) {
					if (placement.bindParameterValue == null) throw new Error('A value evaluator is required for ' + binding.inputSource);
					const evaluate = placement.bindParameterValue(binding, definition, path);
					step = { evaluate(frame) { value = evaluate(frame); } };
				}
				dependencies.add(step);
			},
		};
	}

	function planPlacement(effect: ResolvedEffect, bind: (id: string) => PlannedInput, baseResolution: () => Resolution,
		fixedResolution: Resolution | null, staticSettings: StaticSettingValues, path: readonly string[]): ResolvePort {
		const inputs = new Map<string, PlannedInput>();

		function parameter(id: string): PlannedInput {
			let input = inputs.get(id);
			if (input == null) {
				input = bind(id);
				// 公開画像はそのまま転送し、実際に画像を読む内部接続がFit/Wrap/Filterを所有する。
				if (effect.type === 'customNodeGraphEffect') input = withSampling(input);
				inputs.set(id, input);
			}
			return input;
		}

		let resolution = fixedResolution;

		function getResolution(): Resolution {
			if (resolution != null) return resolution;
			for (const id of effect.definition.resolutionInputParameters) resolution = largestInputResolution(parameter(id).input, resolution);
			resolution ??= baseResolution();
			return resolution;
		}

		if (effect.type === 'customNodeGraphEffect') {
			const graph = effect.definition;
			const nodes = new Map(graph.nodes.map(node => [node.id, node]));
			const placements = new Map<string, ResolvePort>();

			function nodeOutput(reference: NodeOutputReference): PlannedInput | null {
				let resolve = placements.get(reference.nodeId);
				if (resolve == null) {
					const node = nodes.get(reference.nodeId)!;
					const child = resolveEffectSource(node.effectSource, placement.definitions);
					const childPath = [...path, node.id];
					const childInput = (id: string) => {
						const def = child.definition.paramDefs[id];
						return planBinding(def, node.params[id] ?? def.defaultValue, parameter, nodeOutput, childPath);
					};
					if (node.isBypass === true) {
						const primary = child.definition.primaryInputParameter;
						const bypass = primary == null ? null : childInput(primary);
						resolve = () => bypass;
					} else {
						resolve = planPlacement(child, childInput, getResolution, node.resolution ?? null, node.staticSettings ?? {}, childPath);
					}
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
			staticSettings: createStaticSettingValues(effect.definition.staticSettingDefs ?? {}, staticSettings),
			bindOutputTextures: new Map(), dependencies: new Set(),
		};
		const ports = new Map<string, PlannedInput>();
		return id => {
			const existing = ports.get(id);
			if (existing != null) return existing;
			// 計画中は種別・寸法だけで配線できる。履歴の書き込み先が交替しても、このポートから最新の結果を読める。
			let texture: GPUTexture;
			const port: PlannedInput = {
				input: { kind: 'texture', resolution: renderer.resolution, get texture() { return texture; } },
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
	const resolve = planPlacement(root, id => {
		const input = placement.inputs?.[id];
		return input != null ? { input } : planBinding(root.definition.paramDefs[id], root.definition.paramDefs[id].defaultValue, noParent, noParent, []);
	}, () => placement.resolution, placement.resolution, placement.staticSettings ?? {}, []);
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
	return { steps: ordered, outputs };
}
