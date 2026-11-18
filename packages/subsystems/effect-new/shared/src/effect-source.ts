import type { CustomNodeGraphEffect } from './custom-node-graph-effect/types.ts';
import type { CustomShaderEffect } from './custom-shader-effect/types.ts';
import type { EffectDefinition } from './effect-definition.ts';

export type EffectSource =
	| { type: 'nativeEffect'; id: string }
	| { type: 'customShaderEffectReference'; id: string }
	| { type: 'inlineCustomShaderEffect'; customShaderEffect: CustomShaderEffect }
	| { type: 'customNodeGraphEffectReference'; id: string }
	| { type: 'inlineCustomNodeGraphEffect'; customNodeGraphEffect: CustomNodeGraphEffect };

export type EffectCatalog = {
	nativeEffects: ReadonlyMap<string, EffectDefinition>;
	customShaderEffects: ReadonlyMap<string, CustomShaderEffect>;
	customNodeGraphEffects: ReadonlyMap<string, CustomNodeGraphEffect>;
};

export type ResolvedEffectSource =
	| { type: 'nativeEffect'; id: string; definition: EffectDefinition }
	| { type: 'customShaderEffect'; definition: CustomShaderEffect }
	| { type: 'customNodeGraphEffect'; definition: CustomNodeGraphEffect };

function getReferencedEffect<Definition>(catalog: ReadonlyMap<string, Definition>, id: string, kind: string): Definition {
	const definition = catalog.get(id);
	if (definition == null) throw new Error(`${kind} not found: ${id}`);
	return definition;
}

export function resolveEffectSource(source: EffectSource, catalog: EffectCatalog): ResolvedEffectSource {
	switch (source.type) {
		case 'nativeEffect':
			return { type: 'nativeEffect', id: source.id, definition: getReferencedEffect(catalog.nativeEffects, source.id, 'Native Effect') };
		case 'customShaderEffectReference':
			return { type: 'customShaderEffect', definition: getReferencedEffect(catalog.customShaderEffects, source.id, 'Custom Shader Effect') };
		case 'inlineCustomShaderEffect':
			return { type: 'customShaderEffect', definition: source.customShaderEffect };
		case 'customNodeGraphEffectReference':
			return { type: 'customNodeGraphEffect', definition: getReferencedEffect(catalog.customNodeGraphEffects, source.id, 'Custom Node Graph Effect') };
		case 'inlineCustomNodeGraphEffect':
			return { type: 'customNodeGraphEffect', definition: source.customNodeGraphEffect };
	}
}

export function resolveEffectDefinition(source: EffectSource, catalog: EffectCatalog): EffectDefinition {
	return resolveEffectSource(source, catalog).definition;
}
