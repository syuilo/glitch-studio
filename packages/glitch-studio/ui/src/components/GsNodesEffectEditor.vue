<template>
<div
	ref="root" :class="$style.root" data-nodes-effect-editor data-test-nodes-effect-editor
	@dragenter.capture="assetDrop.onDragenter" @dragover.capture="assetDrop.onDragover"
	@dragleave.capture="assetDrop.onDragleave" @drop.capture="assetDrop.onDrop"
>
	<div :class="$style.header">
		<div style="padding: 0 8px;">
			<GsTabs v-model="tab" :def="tabs" data-test-nodes-effect-tabs/>
		</div>
	</div>

	<div style="flex: 1; min-height: 0;">
		<div v-if="tab === 'nodes'" style="height: 100%; overflow: auto; background: var(--THEME-bg);">
			<div :class="$style.nodesContent" class="_gaps_m">
				<XGlobalInNode v-if="globalInNode" :nodesEffect="nodesEffect" :node="globalInNode" :class="$style.node"/>

				<hr>

				<GsDraggable
					:modelValue="nodesEffect.nodes.filter(node => node.type !== 'globalIn' && node.type !== 'globalOut')"
					direction="vertical"
					manualDragStart
					withGaps
					@update:modelValue="onSorted"
				>
					<template #default="{ item: node, dragStart }">
						<XEffectNode
							v-if="node.type === 'effect'"
							:nodesEffect="nodesEffect"
							:node="node"
							:class="$style.node"
							@dragStart="dragStart"
							@staticSetting="edit => emit('edit', { kind: 'editNodeStaticSetting', nodeId: node.id, ...edit })"
							@editParam="edit => emit('edit', { kind: 'editNodeParam', nodeId: node.id, edit })"
							@resetParameters="emit('edit', { kind: 'resetNodeParameters', nodeId: node.id })"
							@remove="emit('edit', { kind: 'removeNode', nodeId: node.id })"
							@setBypass="bypass => emit('edit', { kind: 'setNodeBypass', nodeId: node.id, bypass })"
							@setResolution="resolution => emit('edit', { kind: 'setNodeResolution', nodeId: node.id, resolution })"
							@setDisplayName="displayName => emit('edit', { kind: 'setNodeDisplayName', nodeId: node.id, displayName })"
						/>
						<GsRelayNode
							v-else-if="node.type === 'relay'"
							:nodesEffect="nodesEffect"
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
								{{ i18n.ts._NodesEffect.AddEffectNode }}...
							</GsButton>
							<GsButton large fit data-test-nodes-effect-add-node-menu @click="showAddNodeMenu">...</GsButton>
						</div>
					</template>
				</GsDraggable>

				<hr>

				<XGlobalOutNode
					v-if="globalOutNode" :node="globalOutNode" :nodesEffect="nodesEffect" :class="$style.node"
					@changeInput="onOutputInputChange"
				/>

				<GsWires :nodesEffect="nodesEffect"/>
			</div>
		</div>

		<div v-else-if="tab === 'customParameters'" style="height: 100%; overflow: auto;">
			<XCustomParameters :nodesEffect="nodesEffect" @edit="emit('edit', $event)"/>
		</div>

		<div v-else-if="tab === 'inputs'" style="height: 100%; overflow: auto;">
			<XParamDefsEditor
				:nodesEffect="nodesEffect"
				@add="def => emit('edit', { kind: 'addParamDef', def })"
				@update="(defId, changes, mergeKey) => emit('edit', { kind: 'updateParamDef', defId, changes, mergeKey })"
				@remove="defId => emit('edit', { kind: 'removeParamDef', defId })"
				@setPrimaryInput="inputId => emit('edit', { kind: 'setPrimaryInput', inputId })"
				@setPrimaryAudioInput="inputId => emit('edit', { kind: 'setPrimaryAudioInput', inputId })"
			/>
		</div>

		<div v-else-if="tab === 'outputs'" style="height: 100%; overflow: auto;">
			<XOutputDefsEditor
				:nodesEffect="nodesEffect"
				@add="def => emit('edit', { kind: 'addOutputDef', def })"
				@update="(defId, changes) => emit('edit', { kind: 'updateOutputDef', defId, changes })"
				@remove="defId => emit('edit', { kind: 'removeOutputDef', defId })"
				@setPrimaryOutput="outputId => emit('edit', { kind: 'setPrimaryOutput', outputId })"
			/>
		</div>

		<div v-else-if="tab === 'preview'" :class="$style.preview">
			<slot name="preview"></slot>
		</div>

		<div v-else-if="tab === 'other'" class="_spacer _gaps_m" style="height: 100%; overflow: auto;">
			<GsInput large :modelValue="nodesEffectName" manualSave @update:modelValue="name => emit('rename', name)"><template #label>{{ i18n.ts.Name }}</template></GsInput>
			<GsButton large :disabled="exporting" :wait="exporting" icon="ti ti-download" @click="emit('requestExport', 'gsne')">{{ `${i18n.ts._NodesEffect.Export}...` }}</GsButton>
			<GsButton
				v-if="isDesktop"
				large
				:disabled="exporting"
				icon="ti ti-world"
				data-test-nodes-effect-web-export-open
				@click="emit('requestExport', 'web')"
			>
				{{ i18n.ts._NodesEffect.WebExport }}...
			</GsButton>
			<div v-else>{{ i18n.ts._NodesEffect.WebExportDesktopOnly }}</div>
		</div>
	</div>
	<GsDropOverlay v-if="assetDrop.hovering.value" data-test-nodes-effect-drop-overlay/>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, inject, provide } from 'vue';
import { nodesEffectTargetKey } from '@gs/glitch-studio_shared/project/nodes-effect-target.ts';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsDropOverlay from './common/GsDropOverlay.vue';
import GsRelayNode from './GsRelayNode.vue';
import XEffectNode from './GsEffectNode.vue';
import XGlobalInNode from './GsGlobalInNode.vue';
import XGlobalOutNode from './GsGlobalOutNode.vue';
import XParamDefsEditor from './GsNodesEffectEditor.ParamDefsEditor.vue';
import XCustomParameters from './GsNodesEffectEditor.CustomParameters.vue';
import XOutputDefsEditor from './GsNodesEffectEditor.OutputDefsEditor.vue';
import GsTabs from './common/GsTabs.vue';
import type { NodesEffect, NodesEffectGlobalInNode, NodesEffectGlobalOutNode, NodesEffectNode, NodeOutputReference } from '@/types/nodes-effect-view.ts';
import type { NodesEffectEdit, NodesEffectAssetDropActions } from '@/types/nodes-effect-editor.ts';
import type { NodesEffectTarget } from '@/utility/nodes-effect-target.ts';
import { i18n } from '@/i18n.ts';
import { preferences } from '@/preferences.ts';
import { provideNodesEffectWires } from '@/utility/nodes-effect-wires.ts';
import { useAssetDrop } from '@/composables/useAssetDrop.ts';
import * as ui from '@/ui.ts';
import { previewParameterContextKey } from '@/utility/preview-parameter-editing.ts';
import { parameterExpansionScopeKey } from '@/composables/useParameterExpansion.ts';

provideNodesEffectWires();

const isDesktop = __ELECTRON__ && window.desktop != null;

const slots = defineSlots<{ preview?: () => unknown }>();
const props = defineProps<{
	nodesEffect: NodesEffect;
	nodesEffectName: string;
	previewTarget?: NodesEffectTarget;
	exporting?: boolean;
	assetDropActions: NodesEffectAssetDropActions | null;
}>();

const tab = ref('nodes');
const livePreviewParameterContext = inject(previewParameterContextKey, null);
provide(previewParameterContextKey, {
	scope: computed(() => tab.value === 'preview' ? livePreviewParameterContext?.scope.value ?? null
	: props.previewTarget == null ? null : { kind: 'nodesEffect' as const, target: props.previewTarget }),
	label: computed(() => props.nodesEffectName),
	beginLivePreviewEdit: livePreviewParameterContext?.beginLivePreviewEdit,
});
provide(parameterExpansionScopeKey, computed(() => props.previewTarget == null ? null : nodesEffectTargetKey(props.previewTarget)));

const emit = defineEmits<{
	edit: [event: NodesEffectEdit];
	rename: [name: string];
	requestAddEffectNode: [];
	requestExport: [format: 'gsne' | 'web'];
}>();

const assetDrop = useAssetDrop({
	target: useTemplateRef<HTMLElement>('root'),
	projectSessionId: () => props.assetDropActions?.projectSessionId ?? null,
	enabled: () => props.assetDropActions != null,
	dropFiles: async files => { if (await props.assetDropActions?.dropFiles(files) === true) tab.value = 'nodes'; },
	dropAsset: async assetId => { if (await props.assetDropActions?.dropAsset(assetId) === true) tab.value = 'nodes'; },
	reportError: error => { void ui.alert({ type: 'error', title: i18n.ts._NodesEffect.Drop, text: error instanceof Error ? error.message : String(error) }); },
});

const showShortLabels = preferences.r.showShortLabels;
const tabDefinitions = [
	{ id: 'nodes', label: i18n.ts._NodesEffect.Nodes, shortLabel: 'Nd' },
	{ id: 'customParameters', label: i18n.ts._Parameter.CustomParameter, shortLabel: 'Cp' },
	{ id: 'inputs', label: i18n.ts._NodesEffect.InputDefs, shortLabel: 'In' },
	{ id: 'outputs', label: i18n.ts._NodesEffect.OutputDefs, shortLabel: 'Out' },
	...(slots.preview == null ? [] : [{ id: 'preview', label: i18n.ts.Preview, shortLabel: 'Pv' }]),
	{ id: 'other', label: i18n.ts.Other, shortLabel: 'Oth' },
];
const tabs = computed(() => tabDefinitions.map(({ id, label, shortLabel }) => ({
	id,
	label: showShortLabels.value ? shortLabel : label,
	tooltip: showShortLabels.value ? label : null,
})));

const globalInNode = computed(() => props.nodesEffect.nodes.find((node): node is NodesEffectGlobalInNode => node.type === 'globalIn'));
const globalOutNode = computed(() => props.nodesEffect.nodes.find((node): node is NodesEffectGlobalOutNode => node.type === 'globalOut'));

function showAddNodeMenu(event: PointerEvent) {
	ui.popupMenu([{
		id: 'add-relay-node',
		text: i18n.ts._NodesEffect.AddRelayNode,
		action: () => emit('edit', { kind: 'addRelayNode' }),
	}], event.currentTarget ?? event.target);
}

function onSorted(nodes: NodesEffectNode[]) {
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
.preview {
	height: 100%;
	overflow: auto;
}

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
