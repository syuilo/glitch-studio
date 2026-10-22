import { genId } from '@gs/shared/utility/id.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';

export function createProjectVisualModule(currentVisualModuleCount: number): ProjectVisualModule {
	const inputId = visualModuleCustomParameterId(genId());
	const outputId = genId();
	return {
		id: genId(),
		name: `VM${currentVisualModuleCount + 1}`,
		paramDefs: [{
			id: inputId,
			nameForReference: visualModuleCustomParameterName('input'),
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
