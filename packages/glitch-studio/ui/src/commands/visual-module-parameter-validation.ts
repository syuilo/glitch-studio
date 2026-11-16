import { inspectStaticParameter } from '@gs/shared/parameter/static-parameter.ts';
import { walkParameters, paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { validateVisualModuleAudioBinding } from '@gs/subsystems_visual-module_shared/audio-parameters.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { VisualModule, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectState } from '../Project.ts';

export function validateVisualModuleNodeParameterBinding(state: ProjectState, visualModule: VisualModule, definition: ParameterDefinition, binding: VisualModuleParameterBinding,
	policy: 'strict' | 'allowMismatch' = 'strict', previousBinding: VisualModuleParameterBinding | null = null) {
	if (policy !== 'strict' && policy !== 'allowMismatch') throw new Error('Invalid connection type policy');
	inspectStaticParameter<VisualModuleParameterBinding>(definition, binding, (parameterDefinition, parameterBinding) => {
		if (!['literal', 'expression', 'envVariable', 'automationGraphReference', 'automationGraphInline', 'keyframesTimelineInline', 'visualModulePublicParameterReference', 'visualModuleCustomParameterValueReference', 'node'].includes(parameterBinding.inputSource)) throw new Error('Unsupported Visual Module parameter input source');
		validateVisualModuleAudioBinding(parameterDefinition, parameterBinding, visualModule.paramDefs);
		if (parameterDefinition.dataType.kind === 'audioSource' && parameterBinding.inputSource === 'literal') validatePlayerAudioSourceSelection(parameterBinding.value);
	});
	const definitions = { parameter: definition };
	const previous = new Map(previousBinding == null ? [] : [...walkParameters<VisualModuleParameterBinding>(definitions, { parameter: previousBinding })]
		.map(parameter => [paramPathKey(parameter.path), parameter.value]));
	for (const { path, def, value } of walkParameters<VisualModuleParameterBinding>(definitions, { parameter: binding })) {
		if (value.inputSource !== 'node') continue;
		const inputType = getNodeInputDataType(def);
		if (inputType == null) throw new Error('Parameter does not support node input');
		if (value.nodeId == null) {
			if (value.outputPort != null) throw new Error('A disconnected node input cannot reference an output port');
		} else {
			const previousValue = previous.get(paramPathKey(path));
			// 型不一致を許可した接続や、公開入力の削除で未解決になった接続も保持する。
			// 別要素の削除やサンプリング編集で拒否せず、定義のUndoで再び有効にできるようにする。
			// indexではなく完全なIDパスで照合し、新しい要素・接続先は存在と型を検証する。
			const retainedConnection = previousValue?.inputSource === 'node' && previousValue.nodeId === value.nodeId && previousValue.outputPort === value.outputPort;
			if (retainedConnection) continue;
			const source = visualModule.nodes.find(candidate => candidate.id === value.nodeId);
			const output = getNodeOutputs(source, visualModule.paramDefs, getEffectDefinitions(state))[value.outputPort];
			if (output == null) throw new Error('Node output not found in this Visual Module');
			if (policy === 'strict' && !areNodeDataTypesCompatible(output.dataType, inputType)) throw new Error('Node output type does not match the parameter');
		}
	}
}

