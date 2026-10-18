<template>
<div ref="root" :class="$style.root" data-visual-module-editor data-test-visual-module-editor
	@dragenter.capture="assetDrop.onDragenter" @dragover.capture="assetDrop.onDragover"
	@dragleave.capture="assetDrop.onDragleave" @drop.capture="assetDrop.onDrop"
>
	<div :class="$style.header">
		<div style="padding: 8px;">
			<GsTabs v-model="tab" :def="tabs" data-test-visual-module-tabs/>
		</div>
	</div>

	<div style="flex: 1; min-height: 0;">
		<div v-if="tab === 'nodes'" style="height: 100%; overflow: auto; background: var(--THEME-bg);">
			<div :class="$style.nodesContent" class="_gaps_m">
				<XGlobalInNode v-if="globalInNode" :visualModule="visualModule" :node="globalInNode" :class="$style.node"/>

				<hr>

				<GsDraggable
					:modelValue="visualModule.nodes.filter(node => node.type !== 'globalIn' && node.type !== 'globalOut')"
					direction="vertical"
					manualDragStart
					withGaps
					@update:modelValue="onSorted"
				>
					<template #default="{ item: node, dragStart }">
						<XEffectNode
							v-if="node.type === 'effect'"
							:visualModule="visualModule"
							:node="node"
							:effectState="effectStates?.get(node.id)"
							:class="$style.node"
							@dragStart="dragStart"
							@editParam="edit => emit('edit', { kind: 'editNodeParam', nodeId: node.id, edit })"
							@remove="emit('edit', { kind: 'removeNode', nodeId: node.id })"
							@setBypass="bypass => emit('edit', { kind: 'setNodeBypass', nodeId: node.id, bypass })"
							@setResolution="resolution => emit('edit', { kind: 'setNodeResolution', nodeId: node.id, resolution })"
							@setDisplayName="displayName => emit('edit', { kind: 'setNodeDisplayName', nodeId: node.id, displayName })"
						/>
					</template>
					<template #footer>
						<GsButton large :class="$style.addButton" full style="margin-top: 8px;" icon="ti ti-plus" @click="emit('requestAddEffectNode')">{{ i18n.ts._VisualModule.AddEffectNode }}</GsButton>
					</template>
				</GsDraggable>

				<hr>

				<XGlobalOutNode
					v-if="globalOutNode" :node="globalOutNode" :visualModule="visualModule" :class="$style.node"
					@changeInput="onOutputInputChange"
				/>

				<GsWires :visualModule="visualModule"/>
			</div>
		</div>

		<div v-else-if="tab === 'inputs'" style="height: 100%; overflow: auto;">
			<XParamDefsEditor
				:visualModule="visualModule"
				@add="def => emit('edit', { kind: 'addParamDef', def })"
				@update="(defId, changes, mergeKey) => emit('edit', { kind: 'updateParamDef', defId, changes, mergeKey })"
				@remove="defId => emit('edit', { kind: 'removeParamDef', defId })"
				@setPrimaryInput="inputId => emit('edit', { kind: 'setPrimaryInput', inputId })"
				@setPrimaryAudioInput="inputId => emit('edit', { kind: 'setPrimaryAudioInput', inputId })"
			/>
		</div>

		<div v-else-if="tab === 'outputs'" style="height: 100%; overflow: auto;">
			<XOutputDefsEditor
				:visualModule="visualModule"
				@add="def => emit('edit', { kind: 'addOutputDef', def })"
				@update="(defId, changes) => emit('edit', { kind: 'updateOutputDef', defId, changes })"
				@remove="defId => emit('edit', { kind: 'removeOutputDef', defId })"
				@setPrimaryOutput="outputId => emit('edit', { kind: 'setPrimaryOutput', outputId })"
			/>
		</div>

		<div v-else-if="tab === 'other'" class="_spacer _gaps_m" style="height: 100%; overflow: auto;">
			<GsInput large :modelValue="visualModuleName" :debounce="400" @update:modelValue="name => emit('rename', name)"><template #label>{{ i18n.ts.Name }}</template></GsInput>
			<GsButton large :disabled="exporting" :wait="exporting" icon="ti ti-download" @click="emit('requestExport')">{{ i18n.ts._VisualModule.Export }}</GsButton>
		</div>
	</div>
	<GsDropOverlay v-if="assetDrop.hovering.value" data-test-visual-module-drop-overlay/>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { computed, ref, useTemplateRef } from 'vue';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsDropOverlay from './common/GsDropOverlay.vue';
import XEffectNode from './GsEffectNode.vue';
import XGlobalInNode from './GsGlobalInNode.vue';
import XGlobalOutNode from './GsGlobalOutNode.vue';
import XParamDefsEditor from './GsVisualModuleEditor.ParamDefsEditor.vue';
import XOutputDefsEditor from './GsVisualModuleEditor.OutputDefsEditor.vue';
import GsTabs from './common/GsTabs.vue';
import type { VisualModule, VisualModuleGlobalInNode, VisualModuleGlobalOutNode, VisualModuleNode, NodeOutputReference } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import type { VisualModuleEdit, VisualModuleAssetDropActions } from '@/types/visual-module-editor.ts';
import { provideVisualModuleWires } from '@/utility/visual-module-wires.ts';
import { useAssetDrop } from '@/composables/useAssetDrop.ts';
import * as ui from '@/ui.ts';

provideVisualModuleWires();

const props = defineProps<{
	visualModule: VisualModule;
	visualModuleName: string;
	effectStates?: ReadonlyMap<string, EffectInstanceState> | null;
	exporting?: boolean;
	assetDropActions: VisualModuleAssetDropActions | null;
}>();

const emit = defineEmits<{
	edit: [event: VisualModuleEdit];
	rename: [name: string];
	requestAddEffectNode: [];
	requestExport: [];
}>();

const tab = ref('nodes');
const assetDrop = useAssetDrop({
	target: useTemplateRef<HTMLElement>('root'), enabled: () => props.assetDropActions != null,
	dropFiles: async files => { if (await props.assetDropActions?.dropFiles(files) === true) tab.value = 'nodes'; },
	dropAsset: async assetId => { if (await props.assetDropActions?.dropAsset(assetId) === true) tab.value = 'nodes'; },
	reportError: error => { void ui.alert({ type: 'error', title: i18n.ts._VisualModule.Drop, text: error instanceof Error ? error.message : String(error) }); },
});
const tabs = [
	{ id: 'nodes', label: i18n.ts._VisualModule.Nodes },
	{ id: 'inputs', label: i18n.ts._VisualModule.InputDefs },
	{ id: 'outputs', label: i18n.ts._VisualModule.OutputDefs },
	{ id: 'other', label: i18n.ts.Other },
];

const globalInNode = computed(() => props.visualModule.nodes.find((node): node is VisualModuleGlobalInNode => node.type === 'globalIn'));
const globalOutNode = computed(() => props.visualModule.nodes.find((node): node is VisualModuleGlobalOutNode => node.type === 'globalOut'));

function onSorted(nodes: VisualModuleNode[]) {
	emit('edit', { kind: 'reorderNodes', nodeIds: nodes.map(node => node.id) });
}

function onOutputInputChange(outputId: string, value: NodeOutputReference | null) {
	if (globalOutNode.value == null) return;
	emit('edit', { kind: 'setOutputConnection', nodeId: globalOutNode.value.id, outputId, value });
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

.addButton {
	margin-top: 8px;
}
</style>
