import type { CustomNodeGraphEffect } from './custom-node-graph-effect.ts';
import type { CustomShaderEffect } from './custom-shader-effect.ts';
import type { EffectDefinition, NativeEffectDefinition } from './effect-definition.ts';

type NativeEffectRenderDefinition = Pick<NativeEffectDefinition, keyof EffectDefinition>
	& Partial<Pick<NativeEffectDefinition, 'dependsOnRenderHistory' | 'canHaveLongRunningRenderPass'>>;

export type EffectSource =
	| { type: 'nativeEffect'; id: string }
	| { type: 'customShaderEffectReference'; id: string }
	| { type: 'inlineCustomShaderEffect'; customShaderEffect: CustomShaderEffect }
	| { type: 'customNodeGraphEffectReference'; id: string }
	| { type: 'inlineCustomNodeGraphEffect'; customNodeGraphEffect: CustomNodeGraphEffect };

/** 登録先の探索と欠落時の診断は呼び出し側が所有する。インライン定義に登録IDは不要。 */
export interface EffectDefinitions {
	getNativeEffect(id: string): NativeEffectRenderDefinition;
	getCustomShaderEffect(id: string): CustomShaderEffect;
	getCustomNodeGraphEffect(id: string): CustomNodeGraphEffect;
}

export type ResolvedEffect =
	| { type: 'nativeEffect'; id: string; definition: NativeEffectRenderDefinition }
	| { type: 'customShaderEffect'; definition: CustomShaderEffect }
	| { type: 'customNodeGraphEffect'; definition: CustomNodeGraphEffect };

export function resolveEffectSource(source: EffectSource, definitions: EffectDefinitions): ResolvedEffect {
	switch (source.type) {
		case 'nativeEffect': return { type: 'nativeEffect', id: source.id, definition: definitions.getNativeEffect(source.id) };
		case 'customShaderEffectReference': return { type: 'customShaderEffect', definition: definitions.getCustomShaderEffect(source.id) };
		case 'inlineCustomShaderEffect': return { type: 'customShaderEffect', definition: source.customShaderEffect };
		case 'customNodeGraphEffectReference': return { type: 'customNodeGraphEffect', definition: definitions.getCustomNodeGraphEffect(source.id) };
		case 'inlineCustomNodeGraphEffect': return { type: 'customNodeGraphEffect', definition: source.customNodeGraphEffect };
	}
}
