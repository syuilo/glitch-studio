<template>
<div :class="$style.root" :data-test-visual-module-relay-node="node.id">
	<div
		:class="$style.header"
		:draggable="true"
		@dragstart.stop="emit('dragStart', $event)"
		@contextmenu.prevent.stop="onHeaderContextmenu"
	>
		<b :class="$style.name">{{ node.label || i18n.ts._VisualModule.RelayNode }}</b>
		<div :class="$style.headerButtons">
			<GsButton
				v-tooltip="i18n.ts.Settings"
				:class="$style.headerButton"
				:transparent="!showSettings"
				:primary="showSettings"
				iconOnly
				icon="ti ti-settings"
				data-test-relay-node-settings
				@click="showSettings = !showSettings"
			/>
			<GsButton
				v-tooltip="i18n.ts.Remove"
				:class="$style.headerButton"
				transparent
				iconOnly
				icon="ti ti-x"
				@click="emit('remove')"
			/>
		</div>
	</div>
	<div v-if="showSettings" class="_spacer _gaps_s">
		<GsInput
			large
			manualSave
			:modelValue="node.label ?? ''"
			data-test-relay-node-name
			@update:modelValue="emit('setDisplayName', $event)"
		>
			<template #label>{{ i18n.ts.Name }}</template>
		</GsInput>
		<GsSelect
			large
			:modelValue="node.dataType.kind"
			:items="dataTypeItems"
			data-test-relay-node-data-type
			@update:modelValue="kind => emit('setDataType', { kind })"
		>
			<template #label>{{ i18n.ts._ParameterEditor.DataType }}</template>
		</GsSelect>
	</div>
	<GsVisualModuleNodeInput
		:visualModule="visualModule"
		:nodeId="node.id"
		inputId="input"
		label=""
		:dataType="node.dataType"
		:input="node.input"
		data-test-visual-module-relay-input
		@change="emit('changeInput', $event)"
	/>
	<GsNodeOutputs :node="node"/>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsNodeOutputs from './GsNodeOutputs.vue';
import GsVisualModuleNodeInput from './GsVisualModuleNodeInput.vue';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { NodeOutputReference, VisualModule, VisualModuleRelayNode } from '@gs/subsystems_visual-module_shared/types.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import { clipboardText } from '@/utility/clipboard-text.ts';

const props = defineProps<{
	visualModule: VisualModule;
	node: VisualModuleRelayNode;
}>();

const emit = defineEmits<{
	changeInput: [value: NodeOutputReference | null];
	dragStart: [event: DragEvent];
	remove: [];
	setDisplayName: [displayName: string];
	setDataType: [dataType: TextureDataType];
}>();

const showSettings = ref(false);
const dataTypeItems = (['any', 'color', 'scalar', 'vector'] as const).map(kind => ({
	label: i18n.ts._EffectPicker._DataTypes[kind],
	value: kind,
}));

function onHeaderContextmenu(event: PointerEvent) {
	ui.contextMenu([{
		id: 'copyNodeId',
		text: i18n.ts._Node.CopyNodeId,
		icon: 'ti ti-hash',
		action: () => clipboardText.writeText(props.node.id),
	}], event);
}
</script>

<style module lang="scss">
.root {
	background: var(--THEME-nodeBg);
	border-radius: 6px;
	overflow: clip;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 0 6px 0 8px;
	height: 32px;
	cursor: move;
	background: linear-gradient(0deg, var(--THEME-nodeBg), hsl(from var(--THEME-nodeBg) h s calc(l + 5)));
}

.name {
	min-width: 0;
	overflow: clip;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.headerButtons {
	display: flex;
	flex-shrink: 0;
	gap: 4px;
}

.headerButton {
	width: 23px;
	height: 23px;
	padding: 0;
}
</style>
