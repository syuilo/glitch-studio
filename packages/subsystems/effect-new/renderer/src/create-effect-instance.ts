import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectDefinition, resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createCustomNodeGraphEffectInstance } from './custom-node-graph-effect/create-custom-node-graph-effect-instance.ts';
import { createCustomShaderEffectInstance } from './custom-shader-effect/create-custom-shader-effect-instance.ts';
import { planPublicInputCheck } from './effect-input-kinds.ts';
import type { EffectCatalog, EffectSource, ResolvedEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectInstance, EffectInstanceOptions, NativeEffectImplementation } from './effect-instance.ts';

export type EffectRendererCatalog = EffectCatalog & {
	nativeEffectImplementations: ReadonlyMap<string, NativeEffectImplementation>;
};

/** 設定スナップショットからGPUの準備が完了した配置を作る。以後の render は同期的に呼べる。 */
export async function createEffectInstance(source: EffectSource, options: EffectInstanceOptions, catalog: EffectRendererCatalog): Promise<EffectInstance> {
	const resolved = resolveEffectSource(source, catalog);
	const inputKinds = structuredClone(options.inputKinds);
	const check = planPublicInputCheck(resolved.definition, inputKinds);
	const instance = await createPlacement(resolved, { ...options, inputKinds }, catalog);
	if (check == null) return instance;
	return {
		getOutputKind: id => instance.getOutputKind(id),
		getOutputResolution: id => instance.getOutputResolution(id),
		render(context) {
			check(context.params);
			return instance.render(context);
		},
		dispose: () => instance.dispose(),
	};
}

async function createPlacement(resolved: ResolvedEffectSource, options: EffectInstanceOptions, catalog: EffectRendererCatalog): Promise<EffectInstance> {
	switch (resolved.type) {
		case 'nativeEffect': {
			const implementation = catalog.nativeEffectImplementations.get(resolved.id);
			if (implementation == null) throw new Error(`Native Effect implementation not found: ${resolved.id}`);
			return implementation({
				...options,
				staticSettings: createStaticSettingValues(resolved.definition.staticSettingDefs ?? {}, options.staticSettings),
			});
		}
		case 'customShaderEffect':
			return createCustomShaderEffectInstance(resolved.definition, options);
		case 'customNodeGraphEffect':
			return createCustomNodeGraphEffectInstance(resolved.definition, options,
				childSource => resolveEffectDefinition(childSource, catalog),
				(childSource, childOptions) => createPlacement(resolveEffectSource(childSource, catalog), childOptions, catalog));
	}
}
