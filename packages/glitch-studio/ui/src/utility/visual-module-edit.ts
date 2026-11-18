import type { ProjectState, AppStateChange } from '../Project.ts';
import type { COMMAND_DEFS } from '../commands.ts';
import type { UndoRedo } from './undo-redo.ts';
import type { VisualModuleEdit } from '../types/visual-module-editor.ts';
import type { ParamEdit } from '../components/GsVisualParam.vue';
import type { VisualModuleTarget } from './visual-module-target.ts';
import type { VisualModuleParamDef, VisualModuleValueParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import { findVisualModule } from './visual-module-target.ts';
import { resolveNodeParam } from './node-params.ts';
import { getEffectDefinitions } from './project-effects.ts';
import { editVisualModuleCustomParameterBinding } from './visual-module-custom-parameter-edit.ts';
import { preferences } from '../preferences.ts';

type ProjectCommands = Pick<UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>, 'state' | 'commit'>;

export function commitVisualModuleEdit(manager: ProjectCommands, target: VisualModuleTarget, event: VisualModuleEdit) {
	const visualModule = findVisualModule(manager.state, target);
	if (visualModule == null) return;
	const connectionTypePolicy = preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch';
	switch (event.kind) {
		case 'customParameterClipboard': return; // 非同期のクリップボード操作は所有者が処理する。
		case 'updateCustomParameter': {
			const existing = visualModule.customParameterDefs.some(definition => definition.id === event.definition.id);
			if (existing) manager.commit('replaceVisualModuleCustomParameterDefinition', { target: { visualModule: target, parameterId: event.definition.id }, definition: event.definition }, event.mergeKey);
			else manager.commit('createVisualModuleCustomParameter', { visualModule: target, definition: event.definition });
			break;
		}
		case 'removeCustomParameter':
			manager.commit('removeVisualModuleCustomParameter', { target: { visualModule: target, parameterId: event.parameterId } });
			break;
		case 'editCustomParameter': {
			const parameterTarget = { visualModule: target, parameterId: event.parameterId };
			if (event.edit.kind === 'reset') manager.commit('resetVisualModuleCustomParameter', { target: parameterTarget });
			else if (event.edit.kind === 'expressionModifier') manager.commit('setVisualModuleCustomParameterExpressionModifier', { target: parameterTarget, expressionModifier: event.edit.value }, event.mergeKey);
			else if (event.edit.kind === 'inputSource') manager.commit('switchVisualModuleCustomParameterInputSource', { target: parameterTarget, inputSource: event.edit.inputSource });
			else {
				const definition = visualModule.customParameterDefs.find(candidate => candidate.id === event.parameterId);
				if (definition == null) throw new Error('Visual Module custom parameter not found');
				const current: VisualModuleValueParameterBinding = visualModule.customParameterValues[event.parameterId] ?? definition.defaultValue;
				const source = editVisualModuleCustomParameterBinding(definition, current, event.edit);
				manager.commit('setVisualModuleCustomParameterSource', { target: parameterTarget, source }, event.mergeKey);
			}
			break;
		}
		case 'setNodeDisplayName':
			manager.commit('setVisualModuleNodeDisplayName', { target: { visualModule: target, nodeId: event.nodeId }, displayName: event.displayName }); break;
		case 'setNodeResolution':
			manager.commit('setVisualModuleNodeResolution', { target: { visualModule: target, nodeId: event.nodeId }, resolution: event.resolution }); break;
		case 'addRelayNode':
			manager.commit('createVisualModuleRelayNode', { visualModule: target }); break;
		case 'setRelayInput':
			manager.commit('setVisualModuleRelayInput', { target: { visualModule: target, nodeId: event.nodeId }, source: event.value, connectionTypePolicy }); break;
		case 'removeNode':
			manager.commit('removeVisualModuleNode', { target: { visualModule: target, nodeId: event.nodeId }, reconnection: 'primaryInput', connectionTypePolicy }); break;
		case 'setNodeBypass':
			manager.commit('setVisualModuleNodeBypass', { target: { visualModule: target, nodeId: event.nodeId }, bypass: event.bypass }); break;
		case 'editNodeStaticSetting':
			manager.commit('setVisualModuleNodeStaticSetting', { target: { visualModule: target, nodeId: event.nodeId }, key: event.key, value: event.value }); break;
		case 'editNodeParam':
			onNodeParameterEdit(manager, target, event.nodeId, event.edit); break;
		case 'reorderNodes': {
			// In/Outの位置を維持し、エディタに表示したノードだけを並べ替える。
			const indices = visualModule.nodes.flatMap((node, index) => node.type !== 'globalIn' && node.type !== 'globalOut' ? [index] : []);
			for (const [index, nodeId] of event.nodeIds.entries()) {
				if (visualModule.nodes[indices[index]]?.id === nodeId) continue;
				manager.commit('moveVisualModuleNode', { target: { visualModule: target, nodeId }, index: indices[index] });
			}
			break;
		}
		case 'setOutputConnection':
			manager.commit('setVisualModuleOutputConnection', { target: { visualModule: target, outputId: event.outputId }, source: event.value, connectionTypePolicy }); break;
		case 'addParamDef':
			manager.commit('createVisualModulePublicParameter', { visualModule: target, definition: event.def }); break;
		case 'updateParamDef': {
			const definition = visualModule.paramDefs.find(candidate => candidate.id === event.defId);
			if (definition == null) throw new Error('Visual Module public parameter not found');
			manager.commit('replaceVisualModulePublicParameterDefinition', { target: { visualModule: target, parameterId: event.defId }, definition: { ...definition, ...event.changes } as VisualModuleParamDef }, event.mergeKey); break;
		}
		case 'removeParamDef':
			manager.commit('removeVisualModulePublicParameter', { target: { visualModule: target, parameterId: event.defId } }); break;
		case 'addOutputDef':
			manager.commit('createVisualModuleOutput', { visualModule: target, definition: event.def }); break;
		case 'updateOutputDef': {
			const definition = visualModule.outputDefs.find(candidate => candidate.id === event.defId);
			if (definition == null) throw new Error('Visual Module output not found');
			manager.commit('replaceVisualModuleOutputDefinition', { target: { visualModule: target, outputId: event.defId }, definition: { ...definition, ...event.changes } }); break;
		}
		case 'removeOutputDef':
			manager.commit('removeVisualModuleOutput', { target: { visualModule: target, outputId: event.defId } }); break;
		case 'setPrimaryOutput':
			manager.commit('setVisualModulePrimaryOutput', { target, primaryOutputId: event.outputId }); break;
		case 'setPrimaryAudioInput':
			manager.commit('setVisualModulePrimaryAudioInput', { target, primaryAudioInputId: event.inputId }); break;
		case 'setPrimaryInput':
			manager.commit('setVisualModulePrimaryInput', { target, primaryInputId: event.inputId }); break;
	}
}

function onNodeParameterEdit(manager: ProjectCommands, visualModule: VisualModuleTarget, nodeId: string, event: ParamEdit) {
	const input = { target: { visualModule, nodeId }, parameterPath: event.paramPath };
	switch (event.kind) {
		case 'copy':
		case 'paste': return;
		case 'anotherLayerOutput':
		case 'lowerLayerOutput':
		case 'timelineLayerPublicParameterReference':
		case 'anotherLayerAudio': throw new Error('Timeline input is only available in timeline layer parameters');
		case 'createPublicParameter': manager.commit('createVisualModulePublicParameterFromParameter', input); break;
		case 'createCustomParameter': manager.commit('createVisualModuleCustomParameterFromParameter', input); break;
		case 'literal': manager.commit('setVisualModuleNodeParameterSource', { ...input, source: { inputSource: 'literal', value: event.value } }, event.mergeKey); break;
		case 'automationGraphInline':
		case 'keyframesTimelineInline': manager.commit('setVisualModuleNodeParameterSource', { ...input, source: event.value }, event.mergeKey); break;
		case 'envVariable': manager.commit('setVisualModuleNodeParameterSource', { ...input, source: { inputSource: 'envVariable', variable: event.value } }); break;
		case 'expression': manager.commit('setVisualModuleNodeParameterSource', { ...input, source: { inputSource: 'expression', expression: event.value } }, event.mergeKey); break;
		case 'expressionModifier': manager.commit('setVisualModuleNodeParameterExpressionModifier', { ...input, expressionModifier: event.value }, event.mergeKey); break;
		case 'automationGraphReference': {
			const node = findVisualModule(manager.state, visualModule)?.nodes.find(candidate => candidate.id === nodeId);
			if (node?.type !== 'effect') throw new Error('Effect node not found');
			const current = resolveNodeParam(node, event.paramPath, getEffectDefinitions(manager.state)).value;
			manager.commit('setVisualModuleNodeParameterSource', { ...input, source: { inputSource: 'automationGraphReference', trimmedDurationMs: 1000, wrapMode: 'repeat', offsetMode: 'start',
				...(current.inputSource === 'automationGraphReference' ? current : {}), automationGraphId: event.value, ...event.options } }); break;
		}
		case 'node': manager.commit('setVisualModuleNodeParameterSource', { ...input, source: event.value == null ? { inputSource: 'node', nodeId: null, outputPort: null } : { inputSource: 'node', ...event.value },
			preserveNodeSampling: event.preserveSampling, connectionTypePolicy: preferences.s.forceTypeSafety ? 'strict' : 'allowMismatch' }); break;
		case 'visualModulePublicParameterReference': manager.commit('setVisualModuleNodeParameterSource', { ...input, source: { inputSource: event.kind, parameterId: event.value } }); break;
		case 'visualModuleCustomParameterValueReference': manager.commit('setVisualModuleNodeParameterSource', { ...input, source: { inputSource: event.kind, parameterId: event.value } }); break;
		case 'inputSource':
			if (event.inputSource === 'timelineLayerPublicParameterReference' || event.inputSource === 'anotherLayerOutput' || event.inputSource === 'lowerLayerOutput' || event.inputSource === 'lowerLayerAudio' || event.inputSource === 'anotherLayerAudio') throw new Error('Timeline input is only available in timeline layer parameters');
			manager.commit('switchVisualModuleNodeParameterInputSource', { ...input, inputSource: event.inputSource }); break;
		case 'reset': manager.commit('resetVisualModuleNodeParameter', input); break;
		case 'addElement': manager.commit('insertVisualModuleNodeParameterArrayElement', input); break;
		case 'removeElement': manager.commit('removeVisualModuleNodeParameterArrayElements', { ...input, elementIds: [event.elementId] }); break;
	}
}
