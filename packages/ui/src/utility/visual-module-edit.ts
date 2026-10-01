import type { AppStateManager } from '@/AppStateManager.ts';
import type { VisualModuleEdit } from '@/types/visual-module-editor.ts';
import type { ParamEdit } from '@/components/GsVisualParam.vue';
import type { VisualModuleTarget } from './visual-module-target.ts';
import { findVisualModule } from './visual-module-target.ts';

export function commitVisualModuleEdit(manager: AppStateManager, target: VisualModuleTarget, event: VisualModuleEdit) {
	const module = findVisualModule(manager.state, target);
	if (module == null) return;
	switch (event.kind) {
		case 'setNodeResolution':
			manager.commit('changeNodeResolution', { ...target, nodeId: event.nodeId, resolution: event.resolution });
			break;
		case 'removeNode':
			manager.commit('removeNode', { ...target, nodeId: event.nodeId });
			break;
		case 'setNodeBypass':
			manager.commit('changeNodeBypassState', { ...target, nodeId: event.nodeId, bypass: event.bypass });
			break;
		case 'editNodeParam':
			onNodeParamEdit(manager, target, event.nodeId, event.edit);
			break;
		case 'reorderNodes': {
			// In/Outの位置を維持し、エディタに表示したノードだけを並べ替える。
			const indices = module.nodes.flatMap((node, index) => node.type !== 'globalIn' && node.type !== 'globalOut' ? [index] : []);
			for (const [index, nodeId] of event.nodeIds.entries()) {
				if (module.nodes[indices[index]]?.id === nodeId) continue;
				manager.commit('moveNode', { ...target, nodeId, index: indices[index] });
			}
			break;
		}
		case 'setOutputConnection':
			manager.commit('updateGlobalOutInput', { ...target, nodeId: event.nodeId, outputId: event.outputId, value: event.value });
			break;
		case 'addParamDef':
			manager.commit('addVisualModuleParamDef', { ...target, def: event.def });
			break;
		case 'updateParamDef':
			manager.commit('updateVisualModuleParamDef', { ...target, defId: event.defId, changes: event.changes }, event.mergeKey);
			break;
		case 'removeParamDef':
			manager.commit('removeVisualModuleParamDef', { ...target, defId: event.defId });
			break;
		case 'addOutputDef':
			manager.commit('addVisualModuleOutputDef', { ...target, def: event.def });
			break;
		case 'updateOutputDef':
			manager.commit('updateVisualModuleOutputDef', { ...target, defId: event.defId, changes: event.changes });
			break;
		case 'removeOutputDef':
			manager.commit('removeVisualModuleOutputDef', { ...target, defId: event.defId });
			break;
		case 'setPrimaryOutput':
			manager.commit('setVisualModulePrimaryOutput', { ...target, primaryOutputId: event.outputId });
			break;
		case 'setPrimaryInput':
			manager.commit('setVisualModulePrimaryInput', { ...target, primaryInputId: event.inputId });
			break;
	}
}

function onNodeParamEdit(manager: AppStateManager, moduleTarget: VisualModuleTarget, nodeId: string, event: ParamEdit) {
	const target = { ...moduleTarget, nodeId, paramPath: event.paramPath };
	switch (event.kind) {
		case 'literal': manager.commit('updateParamAsLiteral', { ...target, value: event.value }, event.mergeKey); break;
		case 'automationGraphInline': manager.commit('updateParamAsAutomationGraphInline', { ...target, value: event.value }, event.mergeKey); break;
		case 'envVariable': manager.commit('updateParamAsEnvVariable', { ...target, value: event.value }); break;
		case 'expression': manager.commit('updateParamAsExpression', { ...target, value: event.value }, event.mergeKey); break;
		case 'automationGraphReference': manager.commit('updateParamAsAutomationGraphReference', { ...target, value: event.value, options: event.options }); break;
		case 'keyframesTimelineInline': manager.commit('updateParamAsKeyframesTimelineInline', { ...target, value: event.value }, event.mergeKey); break;
		case 'node': manager.commit('updateParamAsNode', { ...target, value: event.value, preserveSampling: event.preserveSampling }); break;
		case 'externalCustomParameterInput': manager.commit('updateParamAsExternalCustomParameterInput', { ...target, value: event.value }); break;
		case 'inputSource': manager.commit('changeParamValueInputSource', { ...target, inputSource: event.inputSource }); break;
		case 'reset': manager.commit('resetNodeParam', target); break;
		case 'addElement': manager.commit('addArrayParamElement', target); break;
		case 'removeElement': manager.commit('removeArrayParamElement', { ...target, elementId: event.elementId }); break;
	}
}
