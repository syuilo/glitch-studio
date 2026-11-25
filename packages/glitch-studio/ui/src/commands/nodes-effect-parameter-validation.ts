import { inspectStaticParameter } from '@gs/shared/parameter/static-parameter.ts';
import { walkParameters, paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import { canConnectNodeDataTypes, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { validateNodesEffectAudioBinding } from '@/utility/nodes-effect-audio-parameters.ts';
import { getNodeOutputs } from '@/utility/nodes-effect-node-outputs.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import type { ConnectionTypePolicy } from '@gs/shared/data-type/node-compatibility.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { NodesEffect, NodesEffectParameterBinding } from '@/types/nodes-effect-view.ts';
import type { ProjectState } from '../Project.ts';

export function validateNodesEffectNodeParameterBinding(state: ProjectState, nodesEffect: NodesEffect, definition: ParameterDefinition, binding: NodesEffectParameterBinding,
	previousBinding: NodesEffectParameterBinding | null = null, connectionTypePolicy: ConnectionTypePolicy = 'strict') {
	inspectStaticParameter<NodesEffectParameterBinding>(definition, binding, (parameterDefinition, parameterBinding) => {
		if (!['literal', 'expression', 'envVariable', 'curveAnimationReference', 'curveAnimationInline', 'keyframesTimelineInline', 'nodesEffectPublicParameterReference', 'nodesEffectCustomParameterValueReference', 'node'].includes(parameterBinding.inputSource)) throw new Error('Unsupported Nodes Effect parameter input source');
		validateNodesEffectAudioBinding(parameterDefinition, parameterBinding, nodesEffect.paramDefs);
	});
	const definitions = { parameter: definition };
	// 配列要素を並べ替えたり削除したりしても同じBindingを見つけられるよう、完全なIDパスで照合する。
	const previous = new Map(previousBinding == null ? [] : [...walkParameters<NodesEffectParameterBinding>(definitions, { parameter: previousBinding })]
		.map(parameter => [paramPathKey(parameter.path), parameter.value]));
	for (const { path, def, value } of walkParameters<NodesEffectParameterBinding>(definitions, { parameter: binding })) {
		const retained = previous.get(paramPathKey(path));
		if (value.inputSource === 'nodesEffectPublicParameterReference') {
			if (retained?.inputSource === value.inputSource && retained.parameterId === value.parameterId) continue;
			const source = nodesEffect.paramDefs.find(parameter => parameter.id === value.parameterId);
			if (source?.canNode === true && !canConnectNodeDataTypes(getNodeInputDataType(source), getNodeInputDataType(def), connectionTypePolicy)) {
				throw new Error('Public parameter output type does not match the parameter');
			}
		}
		if (value.inputSource !== 'node') continue;
		const inputType = getNodeInputDataType(def);
		if (inputType == null) throw new Error('Parameter does not support node input');
		if (value.nodeId == null) {
			if (value.outputPort != null) throw new Error('A disconnected node input cannot reference an output port');
		} else {
			// 同じ要素の既存配線は、許可済みの型不一致やUndoで復元できる未解決の参照も保持する。
			// 接続先や要素が変われば新しい配線として検査する。
			if (retained?.inputSource === 'node' && retained.nodeId === value.nodeId && retained.outputPort === value.outputPort) continue;
			const source = nodesEffect.nodes.find(candidate => candidate.id === value.nodeId);
			const output = getNodeOutputs(source, nodesEffect.paramDefs, getEffectDefinitions(state))[value.outputPort];
			if (output == null) throw new Error('Node output not found in this Nodes Effect');
			if (!canConnectNodeDataTypes(output.dataType, inputType, connectionTypePolicy)) throw new Error('Node output type does not match the parameter');
		}
	}
}

