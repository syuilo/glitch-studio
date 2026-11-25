import { genId } from '@gs/shared/utility/id.ts';
import type { ProjectNodesEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';

export function createNodesEffectDefinition(): NodesEffect {
	const inputId = genId();
	const outputId = genId();
	return {
		kind: 'modify', primaryInputParameter: inputId, primaryOutput: outputId, resolutionInputParameters: [inputId],
		paramDefs: { [inputId]: { nameForReference: 'input', dataType: { kind: 'color' }, ui: { label: 'Input', control: {} },
			defaultValue: [0, 0, 0, 0], canNode: true } },
		outputDefs: { [outputId]: { label: 'Output', nameForReference: 'output', dataType: { kind: 'color' } } },
		outputSources: {}, nodes: [], customParameterDefs: {}, customParameterValues: {}, functionCurves: [],
	};
}

export function createProjectNodesEffect(currentNodesEffectCount: number): ProjectNodesEffect {
	return { id: genId(), name: `Nodes Effect ${currentNodesEffectCount + 1}`, definition: createNodesEffectDefinition() };
}
