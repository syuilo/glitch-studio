import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { createResolutionExpressionVariables } from '@gs/shared/expression/resolution-variables.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createCustomShaderEffectInstance } from './custom-shader-effect/create-custom-shader-effect-instance.ts';
import { createCustomNodeGraphEffectInstance } from './custom-node-graph-effect/create-custom-node-graph-effect-instance.ts';
import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { createEffectInputTree, createEvaluatedEffectInput, createLiteralBindingInput, createValueBindingReader, frameParameterScope } from './effect-input.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EffectSource, ResolvedEffect } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectEnvironment, EffectInstance, EffectInstanceOptions, EffectParameterInput } from './effect-instance.ts';

/** 配置ごとに呼ぶ。定義の検索も入力種別・出力の決定もここからの初期化中に完了する。 */
export async function createEffectInstance(source: EffectSource, options: EffectInstanceOptions, environment: EffectEnvironment): Promise<EffectInstance> {
	if (options.usedOutputPorts.size === 0) return { outputs: {}, render() {}, dispose() {} };
	const resolved = resolveEffectSource(source, environment.catalog);
	const { resolveAudioSource, expressionEngine } = environment;
	const inputs = new Map(Object.entries(options.inputs));
	let evaluator: ParameterBindingEvaluator | null = null;

	function rootInput(id: string): EffectParameterInput {
		const provided = inputs.get(id);
		if (provided != null) return provided;
		// 未使用の公開入力は展開しない。配置側で指定された入力は、その配置の評価スコープで読み取る。
		const definition = resolved.definition.paramDefs[id];
		const input = createEffectInputTree<ValueParameterBinding>(definition, definition.defaultValue, (leaf, binding) => {
			if (binding.inputSource === 'literal') return createLiteralBindingInput(leaf, binding.value, resolveAudioSource);
			evaluator ??= new ParameterBindingEvaluator(expressionEngine ?? null);
			return createEvaluatedEffectInput(leaf, createValueBindingReader(leaf, binding, evaluator, frame => frameParameterScope(frame, []), createResolutionExpressionVariables(options.resolution)));
		});
		inputs.set(id, input);
		return input;
	}

	const placement = { ...options, usedOutputPorts: new Set(options.usedOutputPorts),
		staticSettings: createStaticSettingValues(resolved.definition.staticSettingDefs ?? {}, options.staticSettings) };

	async function createLeafInstance(effect: Exclude<ResolvedEffect, { type: 'customNodeGraphEffect' }>, leaf: EffectInstanceOptions): Promise<EffectInstance> {
		if (effect.type === 'customShaderEffect') return createCustomShaderEffectInstance(effect.customShaderEffect, leaf);
		const implementation = environment.nativeImplementations.get(effect.definition.id);
		if (implementation == null) throw new Error('Missing Native Effect implementation: ' + effect.definition.id);
		return implementation(leaf);
	}

	if (resolved.type === 'customNodeGraphEffect') return createCustomNodeGraphEffectInstance(resolved.customNodeGraphEffect, placement, environment, createLeafInstance, rootInput);
	const leafInputs = Object.fromEntries(Object.keys(resolved.definition.paramDefs).map(id => [id, rootInput(id)]));
	return createLeafInstance(resolved, { ...placement, inputs: leafInputs });
}
