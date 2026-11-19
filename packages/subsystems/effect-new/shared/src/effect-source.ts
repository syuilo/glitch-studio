import type { EffectDefinition, NativeEffectDefinition } from './effect-definition.ts';
import type { CustomShaderEffect } from './custom-shader-effect/types.ts';
import type { CustomNodeGraphEffect } from './custom-node-graph-effect/types.ts';

/** 配置が保存する指定。登録定義のIDは種類ごとの名前空間に属する。 */
export type EffectSource =
	| { type: 'nativeEffect'; id: string }
	| { type: 'customShaderEffectReference'; id: string }
	| { type: 'inlineCustomShaderEffect'; customShaderEffect: CustomShaderEffect }
	| { type: 'customNodeGraphEffectReference'; id: string }
	| { type: 'inlineCustomNodeGraphEffect'; customNodeGraphEffect: CustomNodeGraphEffect };

export type EffectCatalog = {
	nativeEffects: ReadonlyMap<string, NativeEffectDefinition>;
	customShaderEffects: ReadonlyMap<string, CustomShaderEffect>;
	customNodeGraphEffects: ReadonlyMap<string, CustomNodeGraphEffect>;
};

export type ResolvedEffect =
	| { type: 'nativeEffect'; definition: NativeEffectDefinition }
	| { type: 'customShaderEffect'; definition: EffectDefinition; customShaderEffect: CustomShaderEffect }
	| { type: 'customNodeGraphEffect'; definition: EffectDefinition; customNodeGraphEffect: CustomNodeGraphEffect };

function registeredEffect<T>(entries: ReadonlyMap<string, T>, id: string, type: string): T {
	const entry = entries.get(id);
	if (entry == null) throw new Error(`${type} not found: ${id}`);
	return entry;
}

/** 公開インターフェースは保存し直さず、UIや配置の初期化時に固定IDで引ける形にする。 */
export function resolveEffectSource(source: EffectSource, catalog: EffectCatalog): ResolvedEffect {
	if (source.type === 'nativeEffect') {
		return { type: 'nativeEffect', definition: registeredEffect(catalog.nativeEffects, source.id, 'Native Effect') };
	}
	if (source.type === 'customShaderEffectReference' || source.type === 'inlineCustomShaderEffect') {
		const customShaderEffect = source.type === 'customShaderEffectReference'
			? registeredEffect(catalog.customShaderEffects, source.id, 'Custom Shader Effect') : source.customShaderEffect;
		return { type: 'customShaderEffect', customShaderEffect, definition: {
			...publicEffectDefinition(customShaderEffect),
			resolutionInputParameters: customShaderEffect.resolutionInputIds,
		} };
	}
	const customNodeGraphEffect = source.type === 'customNodeGraphEffectReference'
		? registeredEffect(catalog.customNodeGraphEffects, source.id, 'Custom Node Graph Effect') : source.customNodeGraphEffect;
	return { type: 'customNodeGraphEffect', customNodeGraphEffect, definition: {
		...publicEffectDefinition(customNodeGraphEffect),
		primaryAudioInputParameter: customNodeGraphEffect.primaryAudioInputId ?? null,
		// 個々の出力は、実際に配線されている内部ノードまたは公開入力の寸法を返す。
		resolutionInputParameters: [],
	} };
}

function publicEffectDefinition(effect: CustomShaderEffect | CustomNodeGraphEffect) {
	return {
		kind: effect.kind,
		paramDefs: Object.fromEntries(effect.paramDefs.map(parameter => [parameter.id, parameter])),
		outputDefs: Object.fromEntries(effect.outputDefs.map(output => [output.id, output])),
		primaryInputParameter: effect.primaryInputId,
		primaryOutput: effect.primaryOutputId,
	};
}
