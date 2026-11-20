import { genId } from '@gs/shared/utility/id.ts';
import type { ProjectCustomNodeGraphEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';

export function createCustomNodeGraphEffectDefinition(): CustomNodeGraphEffect {
	const inputId = genId();
	const outputId = genId();
	return {
		kind: 'modify', primaryInputParameter: inputId, primaryOutput: outputId, resolutionInputParameters: [inputId],
		paramDefs: { [inputId]: { nameForReference: 'input', dataType: { kind: 'color' }, ui: { label: 'Input', control: {} },
			defaultValue: [0, 0, 0, 0], canNode: true } },
		outputDefs: { [outputId]: { label: 'Output', nameForReference: 'output', dataType: { kind: 'color' } } },
		outputSources: {}, nodes: [], customParameterDefs: {}, customParameterValues: {}, automationGraphs: [],
	};
}

export function createProjectCustomNodeGraphEffect(currentCustomNodeGraphEffectCount: number): ProjectCustomNodeGraphEffect {
	return { id: genId(), name: `Custom Node Graph Effect ${currentCustomNodeGraphEffectCount + 1}`, definition: createCustomNodeGraphEffectDefinition() };
}
