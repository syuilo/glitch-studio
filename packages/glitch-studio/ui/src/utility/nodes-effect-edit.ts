import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { preferences } from '@/preferences.ts';
import type { ProjectState, AppStateChange } from '../Project.ts';
import type { COMMAND_DEFS } from '../commands.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { NodesEffectEdit } from '../types/nodes-effect-editor.ts';
import type { ParamEdit } from '../components/GsVisualParam.vue';
import type { NodesEffectTarget } from './nodes-effect-target.ts';
import type { NodesEffectParamDef, NodesEffectValueParameterBinding } from '@/types/nodes-effect-view.ts';
import { findNodesEffect } from './nodes-effect-target.ts';
import { resolveNodeParam } from './node-params.ts';
import { getEffectDefinitions } from './project-effects.ts';
import { editNodesEffectCustomParameterBinding } from './nodes-effect-custom-parameter-edit.ts';

type ProjectCommands = Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;

export function commitNodesEffectEdit(manager: ProjectCommands, target: NodesEffectTarget, event: NodesEffectEdit) {
	const nodesEffect = findNodesEffect(manager.state, target);
	if (nodesEffect == null) return;
	const connectionTypePolicy = preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch';

	switch (event.kind) {
		case 'customParameterClipboard': return; // 非同期のクリップボード操作は所有者が処理する。
		case 'updateCustomParameter': {
			const existing = nodesEffect.customParameterDefs.some(definition => definition.id === event.definition.id);
			if (existing) manager.commit('replaceNodesEffectCustomParameterDefinition', { target: { nodesEffect: target, parameterId: event.definition.id }, definition: event.definition }, event.mergeKey);
			else manager.commit('createNodesEffectCustomParameter', { nodesEffect: target, definition: event.definition });
			break;
		}
		case 'removeCustomParameter':
			manager.commit('removeNodesEffectCustomParameter', { target: { nodesEffect: target, parameterId: event.parameterId } });
			break;
		case 'editCustomParameter': {
			const parameterTarget = { nodesEffect: target, parameterId: event.parameterId };
			if (event.edit.kind === 'reset') manager.commit('resetNodesEffectCustomParameter', { target: parameterTarget });
			else if (event.edit.kind === 'expressionModifier') manager.commit('setNodesEffectCustomParameterExpressionModifier', { target: parameterTarget, expressionModifier: event.edit.value }, event.mergeKey);
			else if (event.edit.kind === 'inputSource') manager.commit('switchNodesEffectCustomParameterInputSource', { target: parameterTarget, inputSource: event.edit.inputSource });
			else {
				const definition = nodesEffect.customParameterDefs.find(candidate => candidate.id === event.parameterId);
				if (definition == null) throw new Error('Nodes Effect custom parameter not found');
				const current: NodesEffectValueParameterBinding = nodesEffect.customParameterValues[event.parameterId] ?? createDefaultParameterBinding(definition);
				const source = editNodesEffectCustomParameterBinding(definition, current, event.edit);
				manager.commit('setNodesEffectCustomParameterSource', { target: parameterTarget, source }, event.mergeKey);
			}
			break;
		}
		case 'setNodeDisplayName':
			manager.commit('setNodesEffectNodeDisplayName', { target: { nodesEffect: target, nodeId: event.nodeId }, displayName: event.displayName }); break;
		case 'setNodeResolution':
			manager.commit('setNodesEffectNodeResolution', { target: { nodesEffect: target, nodeId: event.nodeId }, resolution: event.resolution }); break;
		case 'addRelayNode':
			manager.commit('createNodesEffectRelayNode', { nodesEffect: target }); break;
		case 'setRelayInput':
			manager.commit('setNodesEffectRelayInput', { target: { nodesEffect: target, nodeId: event.nodeId }, source: event.value, connectionTypePolicy }); break;
		case 'setRelayDataType':
			manager.commit('setNodesEffectRelayDataType', { target: { nodesEffect: target, nodeId: event.nodeId }, dataType: event.dataType }); break;
		case 'removeNode':
			manager.commit('removeNodesEffectNode', { target: { nodesEffect: target, nodeId: event.nodeId }, reconnection: 'primaryInput', connectionTypePolicy }); break;
		case 'setNodeBypass':
			manager.commit('setNodesEffectNodeBypass', { target: { nodesEffect: target, nodeId: event.nodeId }, bypass: event.bypass }); break;
		case 'editNodeStaticSetting':
			manager.commit('setNodesEffectNodeStaticSetting', { target: { nodesEffect: target, nodeId: event.nodeId }, key: event.key, value: event.value }); break;
		case 'editNodeParam':
			onNodeParameterEdit(manager, target, event.nodeId, event.edit); break;
		case 'resetNodeParameters':
			manager.commit('resetNodesEffectNodeParameters', { target: { nodesEffect: target, nodeId: event.nodeId } }); break;
		case 'reorderNodes': {
			// In/Outの位置を維持し、エディタに表示したノードだけを並べ替える。
			const indices = nodesEffect.nodes.flatMap((node, index) => node.type !== 'globalIn' && node.type !== 'globalOut' ? [index] : []);
			for (const [index, nodeId] of event.nodeIds.entries()) {
				if (nodesEffect.nodes[indices[index]]?.id === nodeId) continue;
				manager.commit('moveNodesEffectNode', { target: { nodesEffect: target, nodeId }, index: indices[index] });
			}
			break;
		}
		case 'setOutputConnection':
			manager.commit('setNodesEffectOutputConnection', { target: { nodesEffect: target, outputId: event.outputId }, source: event.value, connectionTypePolicy }); break;
		case 'addParamDef':
			manager.commit('createNodesEffectPublicParameter', { nodesEffect: target, definition: event.def }); break;
		case 'updateParamDef': {
			const definition = nodesEffect.paramDefs.find(candidate => candidate.id === event.defId);
			if (definition == null) throw new Error('Nodes Effect public parameter not found');
			manager.commit('replaceNodesEffectPublicParameterDefinition', { target: { nodesEffect: target, parameterId: event.defId }, definition: { ...definition, ...event.changes } as NodesEffectParamDef }, event.mergeKey); break;
		}
		case 'removeParamDef':
			manager.commit('removeNodesEffectPublicParameter', { target: { nodesEffect: target, parameterId: event.defId } }); break;
		case 'addOutputDef':
			manager.commit('createNodesEffectOutput', { nodesEffect: target, definition: event.def }); break;
		case 'updateOutputDef': {
			const definition = nodesEffect.outputDefs.find(candidate => candidate.id === event.defId);
			if (definition == null) throw new Error('Nodes Effect output not found');
			manager.commit('replaceNodesEffectOutputDefinition', { target: { nodesEffect: target, outputId: event.defId }, definition: { ...definition, ...event.changes } }); break;
		}
		case 'removeOutputDef':
			manager.commit('removeNodesEffectOutput', { target: { nodesEffect: target, outputId: event.defId } }); break;
		case 'setPrimaryOutput':
			manager.commit('setNodesEffectPrimaryOutput', { target, primaryOutputId: event.outputId }); break;
		case 'setPrimaryAudioInput':
			manager.commit('setNodesEffectPrimaryAudioInput', { target, primaryAudioInputId: event.inputId }); break;
		case 'setPrimaryInput':
			manager.commit('setNodesEffectPrimaryInput', { target, primaryInputId: event.inputId }); break;
	}
}

function onNodeParameterEdit(manager: ProjectCommands, nodesEffect: NodesEffectTarget, nodeId: string, event: ParamEdit) {
	const input = { target: { nodesEffect, nodeId }, parameterPath: event.paramPath };
	switch (event.kind) {
		case 'copy':
		case 'paste': return;
		case 'anotherLayerOutput':
		case 'lowerLayerOutput':
		case 'timelineLayerPublicParameterReference':
		case 'anotherLayerAudio': throw new Error('Timeline input is only available in timeline layer parameters');
		case 'createPublicParameter': manager.commit('createNodesEffectPublicParameterFromParameter', input); break;
		case 'createCustomParameter': manager.commit('createNodesEffectCustomParameterFromParameter', input); break;
		case 'literal': manager.commit('setNodesEffectNodeParameterSource', { ...input, source: { inputSource: 'literal', value: event.value } }, event.mergeKey); break;
		case 'curveAnimationInline':
		case 'keyframesTimelineInline': manager.commit('setNodesEffectNodeParameterSource', { ...input, source: event.value }, event.mergeKey); break;
		case 'envVariable': manager.commit('setNodesEffectNodeParameterSource', { ...input, source: { inputSource: 'envVariable', variable: event.value } }); break;
		case 'expression': manager.commit('setNodesEffectNodeParameterSource', { ...input, source: { inputSource: 'expression', expression: event.value } }, event.mergeKey); break;
		case 'expressionModifier': manager.commit('setNodesEffectNodeParameterExpressionModifier', { ...input, expressionModifier: event.value }, event.mergeKey); break;
		case 'curveAnimationReference': {
			const node = findNodesEffect(manager.state, nodesEffect)?.nodes.find(candidate => candidate.id === nodeId);
			if (node?.type !== 'effect') throw new Error('Effect node not found');
			const current = resolveNodeParam(node, event.paramPath, getEffectDefinitions(manager.state)).value;
			manager.commit('setNodesEffectNodeParameterSource', { ...input, source: { inputSource: 'curveAnimationReference', trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start',
				...(current.inputSource === 'curveAnimationReference' ? current : {}), curveAnimationId: event.value, ...event.options } }); break;
		}
		case 'node': manager.commit('setNodesEffectNodeParameterSource', { ...input, source: event.value == null ? { inputSource: 'node', nodeId: null, outputPort: null } : { inputSource: 'node', ...event.value },
			preserveNodeSampling: event.preserveSampling, connectionTypePolicy: preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch' }); break;
		case 'nodesEffectPublicParameterReference': manager.commit('setNodesEffectNodeParameterSource', { ...input, source: { inputSource: event.kind, parameterId: event.value } }); break;
		case 'nodesEffectCustomParameterValueReference': manager.commit('setNodesEffectNodeParameterSource', { ...input, source: { inputSource: event.kind, parameterId: event.value } }); break;
		case 'inputSource':
			if (event.inputSource === 'previewInputImage' || event.inputSource === 'previewInputAudio') return;
			if (event.inputSource === 'timelineLayerPublicParameterReference' || event.inputSource === 'anotherLayerOutput' || event.inputSource === 'lowerLayerOutput' || event.inputSource === 'lowerLayerAudio' || event.inputSource === 'anotherLayerAudio') throw new Error('Timeline input is only available in timeline layer parameters');
			manager.commit('switchNodesEffectNodeParameterInputSource', { ...input, inputSource: event.inputSource }); break;
		case 'reset': manager.commit('resetNodesEffectNodeParameter', input); break;
		case 'addElement': manager.commit('insertNodesEffectNodeParameterArrayElement', input); break;
		case 'removeElement': manager.commit('removeNodesEffectNodeParameterArrayElements', { ...input, elementIds: [event.elementId] }); break;
	}
}
