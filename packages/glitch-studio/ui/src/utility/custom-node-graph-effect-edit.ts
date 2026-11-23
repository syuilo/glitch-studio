import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { preferences } from '@/preferences.ts';
import type { ProjectState, AppStateChange } from '../Project.ts';
import type { COMMAND_DEFS } from '../commands.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { CustomNodeGraphEffectEdit } from '../types/custom-node-graph-effect-editor.ts';
import type { ParamEdit } from '../components/GsVisualParam.vue';
import type { CustomNodeGraphEffectTarget } from './custom-node-graph-effect-target.ts';
import type { CustomNodeGraphEffectParamDef, CustomNodeGraphEffectValueParameterBinding } from '@/types/custom-node-graph-effect-view.ts';
import { findCustomNodeGraphEffect } from './custom-node-graph-effect-target.ts';
import { resolveNodeParam } from './node-params.ts';
import { getEffectDefinitions } from './project-effects.ts';
import { editCustomNodeGraphEffectCustomParameterBinding } from './custom-node-graph-effect-custom-parameter-edit.ts';

type ProjectCommands = Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;

export function commitCustomNodeGraphEffectEdit(manager: ProjectCommands, target: CustomNodeGraphEffectTarget, event: CustomNodeGraphEffectEdit) {
	const customNodeGraphEffect = findCustomNodeGraphEffect(manager.state, target);
	if (customNodeGraphEffect == null) return;
	const connectionTypePolicy = preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch';

	switch (event.kind) {
		case 'customParameterClipboard': return; // 非同期のクリップボード操作は所有者が処理する。
		case 'updateCustomParameter': {
			const existing = customNodeGraphEffect.customParameterDefs.some(definition => definition.id === event.definition.id);
			if (existing) manager.commit('replaceCustomNodeGraphEffectCustomParameterDefinition', { target: { customNodeGraphEffect: target, parameterId: event.definition.id }, definition: event.definition }, event.mergeKey);
			else manager.commit('createCustomNodeGraphEffectCustomParameter', { customNodeGraphEffect: target, definition: event.definition });
			break;
		}
		case 'removeCustomParameter':
			manager.commit('removeCustomNodeGraphEffectCustomParameter', { target: { customNodeGraphEffect: target, parameterId: event.parameterId } });
			break;
		case 'editCustomParameter': {
			const parameterTarget = { customNodeGraphEffect: target, parameterId: event.parameterId };
			if (event.edit.kind === 'reset') manager.commit('resetCustomNodeGraphEffectCustomParameter', { target: parameterTarget });
			else if (event.edit.kind === 'expressionModifier') manager.commit('setCustomNodeGraphEffectCustomParameterExpressionModifier', { target: parameterTarget, expressionModifier: event.edit.value }, event.mergeKey);
			else if (event.edit.kind === 'inputSource') manager.commit('switchCustomNodeGraphEffectCustomParameterInputSource', { target: parameterTarget, inputSource: event.edit.inputSource });
			else {
				const definition = customNodeGraphEffect.customParameterDefs.find(candidate => candidate.id === event.parameterId);
				if (definition == null) throw new Error('Custom Node Graph Effect custom parameter not found');
				const current: CustomNodeGraphEffectValueParameterBinding = customNodeGraphEffect.customParameterValues[event.parameterId] ?? createDefaultParameterBinding(definition);
				const source = editCustomNodeGraphEffectCustomParameterBinding(definition, current, event.edit);
				manager.commit('setCustomNodeGraphEffectCustomParameterSource', { target: parameterTarget, source }, event.mergeKey);
			}
			break;
		}
		case 'setNodeDisplayName':
			manager.commit('setCustomNodeGraphEffectNodeDisplayName', { target: { customNodeGraphEffect: target, nodeId: event.nodeId }, displayName: event.displayName }); break;
		case 'setNodeResolution':
			manager.commit('setCustomNodeGraphEffectNodeResolution', { target: { customNodeGraphEffect: target, nodeId: event.nodeId }, resolution: event.resolution }); break;
		case 'addRelayNode':
			manager.commit('createCustomNodeGraphEffectRelayNode', { customNodeGraphEffect: target }); break;
		case 'setRelayInput':
			manager.commit('setCustomNodeGraphEffectRelayInput', { target: { customNodeGraphEffect: target, nodeId: event.nodeId }, source: event.value, connectionTypePolicy }); break;
		case 'setRelayDataType':
			manager.commit('setCustomNodeGraphEffectRelayDataType', { target: { customNodeGraphEffect: target, nodeId: event.nodeId }, dataType: event.dataType }); break;
		case 'removeNode':
			manager.commit('removeCustomNodeGraphEffectNode', { target: { customNodeGraphEffect: target, nodeId: event.nodeId }, reconnection: 'primaryInput', connectionTypePolicy }); break;
		case 'setNodeBypass':
			manager.commit('setCustomNodeGraphEffectNodeBypass', { target: { customNodeGraphEffect: target, nodeId: event.nodeId }, bypass: event.bypass }); break;
		case 'editNodeStaticSetting':
			manager.commit('setCustomNodeGraphEffectNodeStaticSetting', { target: { customNodeGraphEffect: target, nodeId: event.nodeId }, key: event.key, value: event.value }); break;
		case 'editNodeParam':
			onNodeParameterEdit(manager, target, event.nodeId, event.edit); break;
		case 'resetNodeParameters':
			manager.commit('resetCustomNodeGraphEffectNodeParameters', { target: { customNodeGraphEffect: target, nodeId: event.nodeId } }); break;
		case 'reorderNodes': {
			// In/Outの位置を維持し、エディタに表示したノードだけを並べ替える。
			const indices = customNodeGraphEffect.nodes.flatMap((node, index) => node.type !== 'globalIn' && node.type !== 'globalOut' ? [index] : []);
			for (const [index, nodeId] of event.nodeIds.entries()) {
				if (customNodeGraphEffect.nodes[indices[index]]?.id === nodeId) continue;
				manager.commit('moveCustomNodeGraphEffectNode', { target: { customNodeGraphEffect: target, nodeId }, index: indices[index] });
			}
			break;
		}
		case 'setOutputConnection':
			manager.commit('setCustomNodeGraphEffectOutputConnection', { target: { customNodeGraphEffect: target, outputId: event.outputId }, source: event.value, connectionTypePolicy }); break;
		case 'addParamDef':
			manager.commit('createCustomNodeGraphEffectPublicParameter', { customNodeGraphEffect: target, definition: event.def }); break;
		case 'updateParamDef': {
			const definition = customNodeGraphEffect.paramDefs.find(candidate => candidate.id === event.defId);
			if (definition == null) throw new Error('Custom Node Graph Effect public parameter not found');
			manager.commit('replaceCustomNodeGraphEffectPublicParameterDefinition', { target: { customNodeGraphEffect: target, parameterId: event.defId }, definition: { ...definition, ...event.changes } as CustomNodeGraphEffectParamDef }, event.mergeKey); break;
		}
		case 'removeParamDef':
			manager.commit('removeCustomNodeGraphEffectPublicParameter', { target: { customNodeGraphEffect: target, parameterId: event.defId } }); break;
		case 'addOutputDef':
			manager.commit('createCustomNodeGraphEffectOutput', { customNodeGraphEffect: target, definition: event.def }); break;
		case 'updateOutputDef': {
			const definition = customNodeGraphEffect.outputDefs.find(candidate => candidate.id === event.defId);
			if (definition == null) throw new Error('Custom Node Graph Effect output not found');
			manager.commit('replaceCustomNodeGraphEffectOutputDefinition', { target: { customNodeGraphEffect: target, outputId: event.defId }, definition: { ...definition, ...event.changes } }); break;
		}
		case 'removeOutputDef':
			manager.commit('removeCustomNodeGraphEffectOutput', { target: { customNodeGraphEffect: target, outputId: event.defId } }); break;
		case 'setPrimaryOutput':
			manager.commit('setCustomNodeGraphEffectPrimaryOutput', { target, primaryOutputId: event.outputId }); break;
		case 'setPrimaryAudioInput':
			manager.commit('setCustomNodeGraphEffectPrimaryAudioInput', { target, primaryAudioInputId: event.inputId }); break;
		case 'setPrimaryInput':
			manager.commit('setCustomNodeGraphEffectPrimaryInput', { target, primaryInputId: event.inputId }); break;
	}
}

function onNodeParameterEdit(manager: ProjectCommands, customNodeGraphEffect: CustomNodeGraphEffectTarget, nodeId: string, event: ParamEdit) {
	const input = { target: { customNodeGraphEffect, nodeId }, parameterPath: event.paramPath };
	switch (event.kind) {
		case 'copy':
		case 'paste': return;
		case 'anotherLayerOutput':
		case 'lowerLayerOutput':
		case 'timelineLayerPublicParameterReference':
		case 'anotherLayerAudio': throw new Error('Timeline input is only available in timeline layer parameters');
		case 'createPublicParameter': manager.commit('createCustomNodeGraphEffectPublicParameterFromParameter', input); break;
		case 'createCustomParameter': manager.commit('createCustomNodeGraphEffectCustomParameterFromParameter', input); break;
		case 'literal': manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: { inputSource: 'literal', value: event.value } }, event.mergeKey); break;
		case 'automationGraphInline':
		case 'keyframesTimelineInline': manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: event.value }, event.mergeKey); break;
		case 'envVariable': manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: { inputSource: 'envVariable', variable: event.value } }); break;
		case 'expression': manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: { inputSource: 'expression', expression: event.value } }, event.mergeKey); break;
		case 'expressionModifier': manager.commit('setCustomNodeGraphEffectNodeParameterExpressionModifier', { ...input, expressionModifier: event.value }, event.mergeKey); break;
		case 'automationGraphReference': {
			const node = findCustomNodeGraphEffect(manager.state, customNodeGraphEffect)?.nodes.find(candidate => candidate.id === nodeId);
			if (node?.type !== 'effect') throw new Error('Effect node not found');
			const current = resolveNodeParam(node, event.paramPath, getEffectDefinitions(manager.state)).value;
			manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: { inputSource: 'automationGraphReference', trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start',
				...(current.inputSource === 'automationGraphReference' ? current : {}), automationGraphId: event.value, ...event.options } }); break;
		}
		case 'node': manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: event.value == null ? { inputSource: 'node', nodeId: null, outputPort: null } : { inputSource: 'node', ...event.value },
			preserveNodeSampling: event.preserveSampling, connectionTypePolicy: preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch' }); break;
		case 'customNodeGraphEffectPublicParameterReference': manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: { inputSource: event.kind, parameterId: event.value } }); break;
		case 'customNodeGraphEffectCustomParameterValueReference': manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...input, source: { inputSource: event.kind, parameterId: event.value } }); break;
		case 'inputSource':
			if (event.inputSource === 'previewInputImage' || event.inputSource === 'previewInputAudio') return;
			if (event.inputSource === 'timelineLayerPublicParameterReference' || event.inputSource === 'anotherLayerOutput' || event.inputSource === 'lowerLayerOutput' || event.inputSource === 'lowerLayerAudio' || event.inputSource === 'anotherLayerAudio') throw new Error('Timeline input is only available in timeline layer parameters');
			manager.commit('switchCustomNodeGraphEffectNodeParameterInputSource', { ...input, inputSource: event.inputSource }); break;
		case 'reset': manager.commit('resetCustomNodeGraphEffectNodeParameter', input); break;
		case 'addElement': manager.commit('insertCustomNodeGraphEffectNodeParameterArrayElement', input); break;
		case 'removeElement': manager.commit('removeCustomNodeGraphEffectNodeParameterArrayElements', { ...input, elementIds: [event.elementId] }); break;
	}
}
