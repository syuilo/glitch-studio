<template>
<div
	ref="root" :class="$style.root" data-custom-node-graph-effect-editor data-test-custom-node-graph-effect-editor
	@dragenter.capture="assetDrop.onDragenter" @dragover.capture="assetDrop.onDragover"
	@dragleave.capture="assetDrop.onDragleave" @drop.capture="assetDrop.onDrop"
>
	<div :class="$style.header">
		<div style="padding: 0 8px;">
			<GsTabs v-model="tab" :def="tabs" data-test-custom-node-graph-effect-tabs/>
		</div>
	</div>

	<div style="flex: 1; min-height: 0;">
		<div v-if="tab === 'nodes'" style="height: 100%; overflow: auto; background: var(--THEME-bg);">
			<div :class="$style.nodesContent" class="_gaps_m">
				<XGlobalInNode v-if="globalInNode" :customNodeGraphEffect="customNodeGraphEffect" :node="globalInNode" :class="$style.node"/>

				<hr>

				<GsDraggable
					:modelValue="customNodeGraphEffect.nodes.filter(node => node.type !== 'globalIn' && node.type !== 'globalOut')"
					direction="vertical"
					manualDragStart
					withGaps
					@update:modelValue="onSorted"
				>
					<template #default="{ item: node, dragStart }">
						<XEffectNode
							v-if="node.type === 'effect'"
							:customNodeGraphEffect="customNodeGraphEffect"
							:node="node"
							:class="$style.node"
							@dragStart="dragStart"
							@staticSetting="edit => emit('edit', { kind: 'editNodeStaticSetting', nodeId: node.id, ...edit })"
							@editParam="edit => emit('edit', { kind: 'editNodeParam', nodeId: node.id, edit })"
							@remove="emit('edit', { kind: 'removeNode', nodeId: node.id })"
							@setBypass="bypass => emit('edit', { kind: 'setNodeBypass', nodeId: node.id, bypass })"
							@setResolution="resolution => emit('edit', { kind: 'setNodeResolution', nodeId: node.id, resolution })"
							@setDisplayName="displayName => emit('edit', { kind: 'setNodeDisplayName', nodeId: node.id, displayName })"
						/>
						<GsRelayNode
							v-else-if="node.type === 'relay'"
							:customNodeGraphEffect="customNodeGraphEffect"
							:node="node"
							:class="$style.node"
							@dragStart="dragStart"
							@changeInput="value => emit('edit', { kind: 'setRelayInput', nodeId: node.id, value })"
							@setDataType="dataType => emit('edit', { kind: 'setRelayDataType', nodeId: node.id, dataType })"
							@remove="emit('edit', { kind: 'removeNode', nodeId: node.id })"
							@setDisplayName="displayName => emit('edit', { kind: 'setNodeDisplayName', nodeId: node.id, displayName })"
						/>
					</template>
					<template #footer>
						<div :class="$style.addButtons">
							<GsButton large :class="$style.addEffectButton" icon="ti ti-plus" @click="emit('requestAddEffectNode')">
								{{ i18n.ts._CustomNodeGraphEffect.AddEffectNode }}...
							</GsButton>
							<GsButton large fit data-test-custom-node-graph-effect-add-node-menu @click="showAddNodeMenu">...</GsButton>
						</div>
					</template>
				</GsDraggable>

				<hr>

				<XGlobalOutNode
					v-if="globalOutNode" :node="globalOutNode" :customNodeGraphEffect="customNodeGraphEffect" :class="$style.node"
					@changeInput="onOutputInputChange"
				/>

				<GsWires :customNodeGraphEffect="customNodeGraphEffect"/>
			</div>
		</div>

		<div v-else-if="tab === 'customParameters'" style="height: 100%; overflow: auto;">
			<XCustomParameters :customNodeGraphEffect="customNodeGraphEffect" @edit="emit('edit', $event)"/>
		</div>

		<div v-else-if="tab === 'inputs'" style="height: 100%; overflow: auto;">
			<XParamDefsEditor
				:customNodeGraphEffect="customNodeGraphEffect"
				@add="def => emit('edit', { kind: 'addParamDef', def })"
				@update="(defId, changes, mergeKey) => emit('edit', { kind: 'updateParamDef', defId, changes, mergeKey })"
				@remove="defId => emit('edit', { kind: 'removeParamDef', defId })"
				@setPrimaryInput="inputId => emit('edit', { kind: 'setPrimaryInput', inputId })"
				@setPrimaryAudioInput="inputId => emit('edit', { kind: 'setPrimaryAudioInput', inputId })"
			/>
		</div>

		<div v-else-if="tab === 'outputs'" style="height: 100%; overflow: auto;">
			<XOutputDefsEditor
				:customNodeGraphEffect="customNodeGraphEffect"
				@add="def => emit('edit', { kind: 'addOutputDef', def })"
				@update="(defId, changes) => emit('edit', { kind: 'updateOutputDef', defId, changes })"
				@remove="defId => emit('edit', { kind: 'removeOutputDef', defId })"
				@setPrimaryOutput="outputId => emit('edit', { kind: 'setPrimaryOutput', outputId })"
			/>
		</div>

		<div v-else-if="tab === 'other'" class="_spacer _gaps_m" style="height: 100%; overflow: auto;">
			<GsInput large :modelValue="customNodeGraphEffectName" manualSave @update:modelValue="name => emit('rename', name)"><template #label>{{ i18n.ts.Name }}</template></GsInput>
			<GsButton large :disabled="exporting" :wait="exporting" icon="ti ti-download" @click="emit('requestExport', 'gscnge')">{{ `${i18n.ts._CustomNodeGraphEffect.Export}...` }}</GsButton>
			<GsButton
				v-if="isDesktop"
				large
				:disabled="exporting"
				icon="ti ti-world"
				data-test-custom-node-graph-effect-web-export-open
				@click="emit('requestExport', 'web')"
			>
				{{ i18n.ts._CustomNodeGraphEffect.WebExport }}...
			</GsButton>
			<div v-else>{{ i18n.ts._CustomNodeGraphEffect.WebExportDesktopOnly }}</div>
		</div>
	</div>
	<GsDropOverlay v-if="assetDrop.hovering.value" data-test-custom-node-graph-effect-drop-overlay/>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, provide } from 'vue';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsDropOverlay from './common/GsDropOverlay.vue';
import GsRelayNode from './GsRelayNode.vue';
import XEffectNode from './GsEffectNode.vue';
import XGlobalInNode from './GsGlobalInNode.vue';
import XGlobalOutNode from './GsGlobalOutNode.vue';
import XParamDefsEditor from './GsCustomNodeGraphEffectEditor.ParamDefsEditor.vue';
import XCustomParameters from './GsCustomNodeGraphEffectEditor.CustomParameters.vue';
import XOutputDefsEditor from './GsCustomNodeGraphEffectEditor.OutputDefsEditor.vue';
import GsTabs from './common/GsTabs.vue';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectGlobalInNode, CustomNodeGraphEffectGlobalOutNode, CustomNodeGraphEffectNode, NodeOutputReference } from '@/types/custom-node-graph-effect-view.ts';
import type { CustomNodeGraphEffectEdit, CustomNodeGraphEffectAssetDropActions } from '@/types/custom-node-graph-effect-editor.ts';
import type { CustomNodeGraphEffectTarget } from '@/utility/custom-node-graph-effect-target.ts';
import { i18n } from '@/i18n.ts';
import { provideCustomNodeGraphEffectWires } from '@/utility/custom-node-graph-effect-wires.ts';
import { useAssetDrop } from '@/composables/useAssetDrop.ts';
import * as ui from '@/ui.ts';
import { previewParameterContextKey } from '@/utility/preview-parameter-editing.ts';
import { parameterExpansionScopeKey } from '@/composables/useParameterExpansion.ts';
import { customNodeGraphEffectTargetKey } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';

provideCustomNodeGraphEffectWires();

const isDesktop = __ELECTRON__ && window.desktop != null;

const props = defineProps<{
	customNodeGraphEffect: CustomNodeGraphEffect;
	customNodeGraphEffectName: string;
	previewTarget?: CustomNodeGraphEffectTarget;
	exporting?: boolean;
	assetDropActions: CustomNodeGraphEffectAssetDropActions | null;
}>();

provide(previewParameterContextKey, {
	scope: computed(() => props.previewTarget == null ? null : { kind: 'customNodeGraphEffect' as const, target: props.previewTarget }),
	label: computed(() => props.customNodeGraphEffectName),
});
provide(parameterExpansionScopeKey, computed(() => props.previewTarget == null ? null : customNodeGraphEffectTargetKey(props.previewTarget)));

const emit = defineEmits<{
	edit: [event: CustomNodeGraphEffectEdit];
	rename: [name: string];
	requestAddEffectNode: [];
	requestExport: [format: 'gscnge' | 'web'];
}>();

const assetDrop = useAssetDrop({
	target: useTemplateRef<HTMLElement>('root'),
	projectSessionId: () => props.assetDropActions?.projectSessionId ?? null,
	enabled: () => props.assetDropActions != null,
	dropFiles: async files => { if (await props.assetDropActions?.dropFiles(files) === true) tab.value = 'nodes'; },
	dropAsset: async assetId => { if (await props.assetDropActions?.dropAsset(assetId) === true) tab.value = 'nodes'; },
	reportError: error => { void ui.alert({ type: 'error', title: i18n.ts._CustomNodeGraphEffect.Drop, text: error instanceof Error ? error.message : String(error) }); },
});

const tab = ref('nodes');
const tabs = [
	{ id: 'nodes', label: i18n.ts._CustomNodeGraphEffect.Nodes },
	{ id: 'customParameters', label: i18n.ts._Parameter.CustomParameter },
	{ id: 'inputs', label: i18n.ts._CustomNodeGraphEffect.InputDefs },
	{ id: 'outputs', label: i18n.ts._CustomNodeGraphEffect.OutputDefs },
	{ id: 'other', label: i18n.ts.Other },
];

const globalInNode = computed(() => props.customNodeGraphEffect.nodes.find((node): node is CustomNodeGraphEffectGlobalInNode => node.type === 'globalIn'));
const globalOutNode = computed(() => props.customNodeGraphEffect.nodes.find((node): node is CustomNodeGraphEffectGlobalOutNode => node.type === 'globalOut'));

function showAddNodeMenu(event: PointerEvent) {
	ui.popupMenu([{
		id: 'add-relay-node',
		text: i18n.ts._CustomNodeGraphEffect.AddRelayNode,
		action: () => emit('edit', { kind: 'addRelayNode' }),
	}], event.currentTarget ?? event.target);
}

function onSorted(nodes: CustomNodeGraphEffectNode[]) {
	emit('edit', { kind: 'reorderNodes', nodeIds: nodes.map(node => node.id) });
}

function onOutputInputChange(outputId: string, value: NodeOutputReference | null) {
	if (globalOutNode.value == null) return;
	emit('edit', {
		kind: 'setOutputConnection',
		nodeId: globalOutNode.value.id,
		outputId,
		value,
	});
}
</script>

<style module lang="scss">
.root {
	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
}

.header {
	position: relative;
}

.nodesContent {
	// ポートと配線を同じ座標系でスクロールさせる。
	position: relative;
	min-height: 100%;
	padding: 8px;
	box-sizing: border-box;
}

.node {
	width: 100%;
}

.addButtons {
	display: flex;
	gap: 4px;
	margin-top: 8px;
}

.addEffectButton {
	flex: 1;
}
</style>
