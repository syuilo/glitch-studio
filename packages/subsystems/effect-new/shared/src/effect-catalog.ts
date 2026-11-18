import { getNativeEffectId, nativeEffectDefinitions } from './native-effect/native-effect-definitions.ts';
import { validateCustomNodeGraphEffect } from './custom-node-graph-effect/validate-custom-node-graph-effect.ts';
import { validateCustomShaderEffect } from './custom-shader-effect/validate-custom-shader-effect.ts';
import { validateEffectDefinition } from './validate-effect-definition.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { EffectSource, CustomNodeGraphEffect, CustomShaderEffect } from './effect-source.ts';

type CustomNodeGraphEffectSource = Extract<EffectSource, { type: 'customNodeGraphEffectReference' | 'inlineCustomNodeGraphEffect' }>;

export class EffectCatalog {
	private readonly customNodeGraphEffects: ReadonlyMap<string, CustomNodeGraphEffect>;
	private readonly customShaderEffects: ReadonlyMap<string, CustomShaderEffect>;

	constructor(options: {
		customNodeGraphEffects?: ReadonlyMap<string, CustomNodeGraphEffect>;
		customShaderEffects?: ReadonlyMap<string, CustomShaderEffect>;
	} = {}) {
		this.customNodeGraphEffects = options.customNodeGraphEffects ?? new Map();
		this.customShaderEffects = options.customShaderEffects ?? new Map();
	}

	getCustomNodeGraphEffect(source: CustomNodeGraphEffectSource): CustomNodeGraphEffect {
		if (source.type === 'inlineCustomNodeGraphEffect') return source.customNodeGraphEffect;
		const definition = this.customNodeGraphEffects.get(source.id);
		if (definition == null) throw new Error(`Unknown Custom Node Graph Effect: ${source.id}`);
		return definition;
	}

	getCustomShaderEffect(id: string): CustomShaderEffect {
		const definition = this.customShaderEffects.get(id);
		if (definition == null) throw new Error(`Unknown Custom Shader Effect: ${id}`);
		return definition;
	}

	getDefinition(source: EffectSource): EffectDefinition {
		switch (source.type) {
			case 'nativeEffect': return nativeEffectDefinitions[getNativeEffectId(source.id)];
			case 'customShaderEffectReference': return this.getCustomShaderEffect(source.id);
			case 'customNodeGraphEffectReference': case 'inlineCustomNodeGraphEffect': return this.getCustomNodeGraphEffect(source);
		}
	}

	/** 設定の受け入れ時に呼ぶ。同じ定義の複数配置は有効で、検査結果は今回の走査内でのみ共有する。 */
	validate(source: EffectSource): void {
		const checked = new Set<EffectDefinition>();
		const activeGraphs = new Map<CustomNodeGraphEffect, string>();
		const visit = (current: EffectSource): EffectDefinition => {
			const definition = this.getDefinition(current);
			if (checked.has(definition)) return definition;
			validateEffectDefinition(definition);
			switch (current.type) {
				case 'nativeEffect': break;
				case 'customShaderEffectReference': validateCustomShaderEffect(this.getCustomShaderEffect(current.id)); break;
				case 'customNodeGraphEffectReference': case 'inlineCustomNodeGraphEffect': {
					const graph = this.getCustomNodeGraphEffect(current);
					const name = current.type === 'inlineCustomNodeGraphEffect' ? '(inline)' : current.id;
					if (activeGraphs.has(graph)) throw new Error(`Custom Node Graph Effect reference cycle: ${[...activeGraphs.values(), name].join(' -> ')}`);
					activeGraphs.set(graph, name);
					validateCustomNodeGraphEffect(graph, visit);
					activeGraphs.delete(graph);
					break;
				}
			}
			checked.add(definition);
			return definition;
		};
		visit(source);
	}
}
