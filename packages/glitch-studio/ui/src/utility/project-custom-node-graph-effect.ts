import { genId } from '@gs/shared/utility/id.ts';
import { customNodeGraphEffectPublicParameterId, customNodeGraphEffectPublicParameterName } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { ProjectCustomNodeGraphEffect } from '@gs/glitch-studio_shared/project/types.ts';

export function createProjectCustomNodeGraphEffect(currentCustomNodeGraphEffectCount: number): ProjectCustomNodeGraphEffect {
	const inputId = customNodeGraphEffectPublicParameterId(genId());
	const outputId = genId();
	return {
		id: genId(),
		name: `Custom Node Graph Effect ${currentCustomNodeGraphEffectCount + 1}`,
		customParameterDefs: [],
		customParameterValues: {},
		paramDefs: [{
			id: inputId,
			nameForReference: customNodeGraphEffectPublicParameterName('input'),
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
			canNode: true,
		}],
		outputDefs: [{ id: outputId, label: 'Output', name: 'output', dataType: { kind: 'color' } }],
		primaryInputId: inputId,
		primaryOutputId: outputId,
		automationGraphs: [],
		nodes: [{ id: genId(), type: 'globalIn' }, { id: genId(), type: 'globalOut', inputs: {} }],
	};
}
