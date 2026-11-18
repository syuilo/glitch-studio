import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createCustomNodeGraphEffectInstance } from './custom-node-graph-effect/custom-node-graph-effect-instance.ts';
import { createCustomShaderEffectInstance } from './custom-shader-effect/create-custom-shader-effect-instance.ts';
import type { EffectCatalog, EffectSource, ResolvedEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EvaluateCustomNodeGraphEffectBinding } from './custom-node-graph-effect/custom-node-graph-effect-instance.ts';
import type { CreateNativeEffectInstance } from './native-effect/native-effect-implementation.ts';
import type { EffectGpuContext, EffectInstance, EffectInstanceOptions } from './effect-instance.ts';

export type EffectInstanceEnvironment = {
	readonly catalog: EffectCatalog;
	readonly gpu: EffectGpuContext;
	getNativeEffectImplementation(id: string): CreateNativeEffectInstance | null;
	readonly evaluateBinding?: EvaluateCustomNodeGraphEffectBinding;
};

/** 定義解決と描画計画はこの境界で完了する。render()には接続や要求ポートを渡さない。 */
export async function createEffectInstance(source: EffectSource, options: EffectInstanceOptions, environment: EffectInstanceEnvironment): Promise<EffectInstance> {
	const resolveSource = (effectSource: EffectSource) => resolveEffectSource(effectSource, environment.catalog);
	const createLeafInstance = async (resolved: Exclude<ResolvedEffectSource, { type: 'customNodeGraphEffect' }>, placement: EffectInstanceOptions): Promise<EffectInstance> => {
		if (resolved.type === 'customShaderEffect') return createCustomShaderEffectInstance(resolved.definition, placement, environment.gpu);
		const createNativeEffectInstance = environment.getNativeEffectImplementation(resolved.id);
		if (createNativeEffectInstance == null) throw new Error(`Unknown Native Effect implementation: ${resolved.id}`);
		const staticSettings = createStaticSettingValues(resolved.definition.staticSettingDefs ?? {}, placement.staticSettings);
		return createNativeEffectInstance({ ...placement, staticSettings }, environment.gpu);
	};

	const resolved = resolveSource(source);
	const placement = { ...structuredClone(options), requestedOutputIds: [...new Set(options.requestedOutputIds)] };
	if (resolved.type === 'customNodeGraphEffect') {
		return createCustomNodeGraphEffectInstance(resolved.definition, placement, resolveSource, createLeafInstance, environment.evaluateBinding);
	}
	return createLeafInstance(resolved, placement);
}
