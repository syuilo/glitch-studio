import type { CustomNodeGraphEffect } from './custom-node-graph-effect/custom-node-graph-effect.ts';
import type { CustomShaderEffect } from './custom-shader-effect/custom-shader-effect.ts';
import type { EffectDefinition } from './effect-definition.ts';

export type EffectSource =
	| { type: 'nativeEffect'; id: string }
	| { type: 'customShaderEffectReference'; id: string }
	| { type: 'inlineCustomShaderEffect'; customShaderEffect: CustomShaderEffect }
	| { type: 'customNodeGraphEffectReference'; id: string }
	| { type: 'inlineCustomNodeGraphEffect'; customNodeGraphEffect: CustomNodeGraphEffect };

/** スナップショットに対応する登録定義だけを呼び出し側が渡す。インライン定義に登録は不要。 */
export type EffectCatalog = {
	nativeEffects: ReadonlyMap<string, EffectDefinition>;
	customShaderEffects: ReadonlyMap<string, CustomShaderEffect>;
	customNodeGraphEffects: ReadonlyMap<string, CustomNodeGraphEffect>;
};

export type ResolvedEffectSource =
	| { type: 'nativeEffect'; id: string; definition: EffectDefinition }
	| { type: 'customShaderEffect'; definition: CustomShaderEffect }
	| { type: 'customNodeGraphEffect'; definition: CustomNodeGraphEffect };

function getRegisteredDefinition<Definition>(catalog: ReadonlyMap<string, Definition>, type: string, id: string): Definition {
	const definition = catalog.get(id);
	if (definition == null) throw new Error(`${type} not found: ${id}`);
	return definition;
}

export function resolveEffectSource(source: EffectSource, catalog: EffectCatalog): ResolvedEffectSource {
	switch (source.type) {
		case 'nativeEffect':
			return { type: 'nativeEffect', id: source.id, definition: getRegisteredDefinition(catalog.nativeEffects, 'Native Effect', source.id) };
		case 'customShaderEffectReference':
			return { type: 'customShaderEffect', definition: getRegisteredDefinition(catalog.customShaderEffects, 'Custom Shader Effect', source.id) };
		case 'inlineCustomShaderEffect':
			return { type: 'customShaderEffect', definition: source.customShaderEffect };
		case 'customNodeGraphEffectReference':
			return { type: 'customNodeGraphEffect', definition: getRegisteredDefinition(catalog.customNodeGraphEffects, 'Custom Node Graph Effect', source.id) };
		case 'inlineCustomNodeGraphEffect':
			return { type: 'customNodeGraphEffect', definition: source.customNodeGraphEffect };
	}
}

export function resolveEffectDefinition(source: EffectSource, catalog: EffectCatalog): EffectDefinition {
	return resolveEffectSource(source, catalog).definition;
}
