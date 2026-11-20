import { inspectStaticParameter } from '@gs/shared/parameter/static-parameter.ts';
import { walkParameters, paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { validateCustomNodeGraphEffectAudioBinding } from '@/utility/custom-node-graph-effect-audio-parameters.ts';
import { getNodeOutputs } from '@/utility/custom-node-graph-effect-node-outputs.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectParameterBinding } from '@/types/custom-node-graph-effect-view.ts';
import type { ProjectState } from '../Project.ts';

export function validateCustomNodeGraphEffectNodeParameterBinding(state: ProjectState, customNodeGraphEffect: CustomNodeGraphEffect, definition: ParameterDefinition, binding: CustomNodeGraphEffectParameterBinding,
	previousBinding: CustomNodeGraphEffectParameterBinding | null = null) {
	inspectStaticParameter<CustomNodeGraphEffectParameterBinding>(definition, binding, (parameterDefinition, parameterBinding) => {
		if (!['literal', 'expression', 'envVariable', 'automationGraphReference', 'automationGraphInline', 'keyframesTimelineInline', 'customNodeGraphEffectPublicParameterReference', 'customNodeGraphEffectCustomParameterValueReference', 'node'].includes(parameterBinding.inputSource)) throw new Error('Unsupported Custom Node Graph Effect parameter input source');
		validateCustomNodeGraphEffectAudioBinding(parameterDefinition, parameterBinding, customNodeGraphEffect.paramDefs);
		if (parameterDefinition.dataType.kind === 'audioSource' && parameterBinding.inputSource === 'literal') validatePlayerAudioSourceSelection(parameterBinding.value);
	});
	const definitions = { parameter: definition };
	const previous = new Map(previousBinding == null ? [] : [...walkParameters<CustomNodeGraphEffectParameterBinding>(definitions, { parameter: previousBinding })]
		.map(parameter => [paramPathKey(parameter.path), parameter.value]));
	for (const { path, def, value } of walkParameters<CustomNodeGraphEffectParameterBinding>(definitions, { parameter: binding })) {
		if (value.inputSource !== 'node') continue;
		const inputType = getNodeInputDataType(def);
		if (inputType == null) throw new Error('Parameter does not support node input');
		if (value.nodeId == null) {
			if (value.outputPort != null) throw new Error('A disconnected node input cannot reference an output port');
		} else {
			const retained = previous.get(paramPathKey(path));
			// 公開入力が削除されても、同じ要素の既存配線はUndoで復元できる。新しい配線は必ず検査する。
			if (retained?.inputSource === 'node' && retained.nodeId === value.nodeId && retained.outputPort === value.outputPort) continue;
			const source = customNodeGraphEffect.nodes.find(candidate => candidate.id === value.nodeId);
			const output = getNodeOutputs(source, customNodeGraphEffect.paramDefs, getEffectDefinitions(state))[value.outputPort];
			if (output == null) throw new Error('Node output not found in this Custom Node Graph Effect');
			if (!areNodeDataTypesCompatible(output.dataType, inputType)) throw new Error('Node output type does not match the parameter');
		}
	}
}

