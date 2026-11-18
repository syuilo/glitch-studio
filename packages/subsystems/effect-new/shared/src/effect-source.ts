import type { CustomNodeGraphEffect } from './custom-node-graph-effect/custom-node-graph-effect.ts';
import type { CustomShaderEffect } from './custom-shader-effect/custom-shader-effect.ts';
import type { NativeEffectDefinition } from './effect-definition.ts';

export type EffectSource =
	| { type: 'nativeEffect'; id: string }
	| { type: 'customShaderEffectReference'; id: string }
	| { type: 'inlineCustomShaderEffect'; customShaderEffect: CustomShaderEffect }
	| { type: 'customNodeGraphEffectReference'; id: string }
	| { type: 'inlineCustomNodeGraphEffect'; customNodeGraphEffect: CustomNodeGraphEffect };

/** 登録IDの有効範囲と定義の保持方法は呼び出し側が決める。 */
export type EffectCatalog = {
	getNativeEffectDefinition: (id: string) => NativeEffectDefinition | null;
	getCustomShaderEffect: (id: string) => CustomShaderEffect | null;
	getCustomNodeGraphEffect: (id: string) => CustomNodeGraphEffect | null;
};

export type ResolvedEffectSource =
	| { type: 'nativeEffect'; id: string; definition: NativeEffectDefinition }
	| { type: 'customShaderEffect'; definition: CustomShaderEffect }
	| { type: 'customNodeGraphEffect'; definition: CustomNodeGraphEffect };

function requireRegisteredEffect<Definition>(definition: Definition | null, kind: string, id: string): Definition {
	if (definition == null) throw new Error(`${kind} not found: ${id}`);
	return definition;
}

/** 配置の参照先だけを解決する。子ノードや他の登録を列挙せず、GPUの準備も必要としない。 */
export function resolveEffectSource(source: EffectSource, catalog: EffectCatalog): ResolvedEffectSource {
	switch (source.type) {
		case 'nativeEffect': {
			const definition = requireRegisteredEffect(catalog.getNativeEffectDefinition(source.id), 'Native Effect', source.id);
			return { type: 'nativeEffect', id: source.id, definition };
		}
		case 'customShaderEffectReference':
		case 'inlineCustomShaderEffect': {
			const definition = source.type === 'inlineCustomShaderEffect' ? source.customShaderEffect
				: requireRegisteredEffect(catalog.getCustomShaderEffect(source.id), 'Custom Shader Effect', source.id);
			return { type: 'customShaderEffect', definition };
		}
		case 'customNodeGraphEffectReference':
		case 'inlineCustomNodeGraphEffect': {
			const definition = source.type === 'inlineCustomNodeGraphEffect' ? source.customNodeGraphEffect
				: requireRegisteredEffect(catalog.getCustomNodeGraphEffect(source.id), 'Custom Node Graph Effect', source.id);
			return { type: 'customNodeGraphEffect', definition };
		}
	}
}
