import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createCustomShaderEffectInstance } from './custom-shader-effect/create-custom-shader-effect-instance.ts';
import { createCustomNodeGraphEffectInstance } from './custom-node-graph-effect/create-custom-node-graph-effect-instance.ts';
import { createDefaultEffectInput } from './effect-input.ts';
import type { EffectSource, ResolvedEffect } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectEnvironment, EffectInstance, EffectInstanceOptions, EffectParameterInput, EffectTextureOutput } from './effect-instance.ts';

/** 配置ごとに呼ぶ。定義の検索も入力種別・出力の決定もここからの初期化中に完了する。 */
export function createEffectInstance(source: Extract<EffectSource, { type: 'nativeEffect' | 'customShaderEffectReference' | 'inlineCustomShaderEffect' }>, options: EffectInstanceOptions, environment: EffectEnvironment): Promise<EffectInstance<EffectTextureOutput>>;
export function createEffectInstance(source: EffectSource, options: EffectInstanceOptions, environment: EffectEnvironment): Promise<EffectInstance>;
export async function createEffectInstance(source: EffectSource, options: EffectInstanceOptions, environment: EffectEnvironment): Promise<EffectInstance> {
	if (options.usedOutputPorts.size === 0) return { outputs: {}, render() {}, dispose() {} };
	const resolved = resolveEffectSource(source, environment.catalog);
	const { resolveAudioSource } = environment;
	const inputs = new Map(Object.entries(options.inputs));

	function rootInput(id: string): EffectParameterInput {
		const provided = inputs.get(id);
		if (provided != null) return provided;
		// 未使用の公開入力は展開しない。配置側で指定された入力は、その配置の評価スコープで読み取る。
		const input = createDefaultEffectInput(resolved.definition.paramDefs[id], resolveAudioSource);
		inputs.set(id, input);
		return input;
	}

	const placement = { ...options, usedOutputPorts: new Set(options.usedOutputPorts),
		staticSettings: createStaticSettingValues(resolved.definition.staticSettingDefs ?? {}, options.staticSettings) };

	async function createLeafInstance(effect: Exclude<ResolvedEffect, { type: 'customNodeGraphEffect' }>, leaf: EffectInstanceOptions): Promise<EffectInstance<EffectTextureOutput>> {
		if (effect.type === 'customShaderEffect') return createCustomShaderEffectInstance(effect.customShaderEffect, leaf);
		const implementation = environment.nativeImplementations.get(effect.definition.id);
		if (implementation == null) throw new Error('Missing Native Effect implementation: ' + effect.definition.id);
		return implementation(leaf);
	}

	if (resolved.type === 'customNodeGraphEffect') return createCustomNodeGraphEffectInstance(resolved.customNodeGraphEffect, placement, environment, createLeafInstance, rootInput);
	const leafInputs = Object.fromEntries(Object.keys(resolved.definition.paramDefs).map(id => [id, rootInput(id)]));
	return createLeafInstance(resolved, { ...placement, inputs: leafInputs });
}
