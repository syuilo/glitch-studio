<template>
<div :class="[$style.root, { [$style.isBypass]: node.isBypass }]">
	<div
		:class="[$style.header, { [$style.hasStatus]: effectStatus?.type === 'loading' || effectStatus?.type === 'error' }]"
		:draggable="true"
		@dragstart.stop="emit('dragStart', $event)"
		@contextmenu.prevent.stop="onHeaderContextmenu"
	>
		<div :class="$style.headerLeft">
			<GsNodePort
				v-show="!expanded && connectedParameterPathKeys.size > 0"
				data-test-node-collapsed-port
				:class="$style.allInPort"
				:dataType="{ kind: 'any' }"
				@update:element="allInPortEl = $event"
			/>
			<div :class="$style.effectName">{{ name }}</div>
			<div v-if="effectStatus?.type === 'loading'" :class="$style.headerButton" inline small iconOnly><i class="ti ti-loader-2" :class="$style.loading"></i></div>
			<div v-else-if="effectStatus?.type === 'error'" :class="[$style.headerButton, $style.error]" inline small iconOnly :v-tooltip="effectStatus.message" @click.stop="showEffectError"><i class="ti ti-alert-triangle"></i></div>
		</div>
		<div :class="$style.headerRight">
			<div :class="$style.nodeId" class="_monospace">{{ prettyId(node.id) }}</div>
			<div :class="$style.headerButtons">
				<GsButton data-test-node-toggle transparent :class="[$style.headerButton]" inline iconOnly :icon="'ti ' + (expanded ? 'ti-chevron-up' : 'ti-chevron-down')" @click="expanded = !expanded"/>
				<GsButton data-test-node-settings :transparent="!showSettings" :class="[$style.headerButton]" inline iconOnly :primary="showSettings" icon="ti ti-settings" @click="showSettings = !showSettings"/>
				<GsButton :transparent="node.isBypass" :class="[$style.headerButton]" inline iconOnly :primary="!node.isBypass" :title="node.isBypass ? i18n.ts._Node.ClickToEnable : i18n.ts._Node.ClickToDisable" :icon="'ti ' + (node.isBypass ? 'ti-eye-closed' : 'ti-eye')" @click="toggleBypass()"/>
				<GsButton transparent :class="[$style.headerButton]" inline iconOnly :title="i18n.ts._Node.RemoveEffect" icon="ti ti-x" @click="remove()"/>
			</div>
		</div>
	</div>

	<div v-show="expanded" :class="$style.params" :inert="node.isBypass">
		<div v-if="showSettings" class="_spacer">
			<GsFolder defaultOpen>
				<template #label>{{ i18n.ts.Settings }}</template>

				<div class="_gaps_s">
					<GsInput large :modelValue="node.displayName" manualSave @update:modelValue="emit('setDisplayName', $event)"><template #label>{{ i18n.ts.Name }}</template></GsInput>
					<GsSelect data-test-node-resolution-mode large :modelValue="node.resolution.mode" :items="resolutionModes" @update:modelValue="setResolutionMode">
						<template #label>{{ i18n.ts.Resolution }}</template>
						<template v-if="node.resolution.mode === 'context'" #caption>{{ i18n.ts._Node.ResolutionHint }}</template>
						<template v-else-if="node.resolution.mode === 'auto'" #caption>{{ i18n.ts._Node.AutoResolutionHint }}</template>
					</GsSelect>
					<GsInput v-if="node.resolution.mode !== 'customAbsolute'" data-test-node-resolution-scale large type="number" :modelValue="node.resolution.scale" :min="0" step="any" manualSave @update:modelValue="setResolutionScale">
						<template #label>{{ i18n.ts._Node.ResolutionScale }}</template>
						<template #suffix>×</template>
						<template #caption>{{ i18n.ts._Node.ResolutionScaleHint }}</template>
					</GsInput>
					<div v-if="node.resolution.mode === 'customAbsolute'" style="display: flex; gap: 8px;">
						<GsInput large style="flex: 1" type="number" manualSave :modelValue="node.resolution.width" :min="1" :step="1" @update:modelValue="setDimension('width', $event)"><template #label>{{ i18n.ts.Width }}</template><template #suffix>px</template></GsInput>
						<GsInput large style="flex: 1" type="number" manualSave :modelValue="node.resolution.height" :min="1" :step="1" @update:modelValue="setDimension('height', $event)"><template #label>{{ i18n.ts.Height }}</template><template #suffix>px</template></GsInput>
					</div>
				</div>
			</GsFolder>
		</div>

		<GsStaticSettings :definitions="effectDefinitions[node.effectId].staticSettingDefs ?? {}" :values="node.staticSettings" @change="emit('staticSetting', $event)"/>

		<GsEffectParameterLayout
			:definition="effectDefinitions[node.effectId]"
			:values="node.params"
			:node="node"
		>
			<template #default="{ parameterKey }">
				<GsVisualParam
					:availableVariables="IN_CUSTOM_NODE_GRAPH_EFFECT_VAR_DEFS"
					:customNodeGraphEffect="customNodeGraphEffect"
					:automationGraphs="customNodeGraphEffect.automationGraphs"
					:node="node"
					:paramPath="[parameterKey]"
					:paramDef="effectDefinitions[node.effectId].paramDefs[parameterKey]"
					:paramValue="node.params[parameterKey]"
					@edit="emit('editParam', $event)"
				/>
			</template>
		</GsEffectParameterLayout>
	</div>

	<GsNodeOutputs style="margin-top: 4px;" :node="node" :outputResolutions="node.isBypass ? null : effectState?.outputs"/>
</div>
</template>

<script lang="ts" setup>
import { IN_CUSTOM_NODE_GRAPH_EFFECT_VAR_DEFS } from '@gs/subsystems_custom-node-graph-effect_shared/expression.ts';
import { ref, computed, provide, shallowRef, watchEffect } from 'vue';
import { prettyId } from '@gs/shared/utility/id.ts';
import { getEffectDefinitions } from '@/utility/project-effects.ts';
import GsNodeOutputs from './GsNodeOutputs.vue';
import GsNodePort from './GsNodePort.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsEffectParameterLayout from './GsEffectParameterLayout.vue';
import GsStaticSettings from './GsStaticSettings.vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsFolder from './common/GsFolder.vue';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import { connectedNodeParameterPathKeysKey, useCustomNodeGraphEffectWires } from '@/utility/custom-node-graph-effect-wires.ts';
import { paramPathKey, walkNodeParams } from '@/utility/node-params.ts';
import { getEffectNodeName } from '@/utility/node-name.ts';
import { getCustomNodeGraphEffectNodeHeaderMenuItems } from '@/utility/custom-node-graph-effect-node-menu.ts';
import * as ui from '@/ui.ts';

const projectSession = useProjectSession();

const effectDefinitions = computed(() => getEffectDefinitions(projectSession.projectContext.stateManager.state));

const { stateManager } = projectSession.projectContext;

const wireMap = useCustomNodeGraphEffectWires();

const props = defineProps<{
	customNodeGraphEffect: CustomNodeGraphEffect;
	node: CustomNodeGraphEffectEffectNode;
	effectState?: EffectInstanceState | null;
}>();

const emit = defineEmits<{
	(ev: 'dragStart', event: DragEvent): void;
	(ev: 'staticSetting', edit: { key: string; value: string | number | boolean | null }): void;
	(ev: 'editParam', event: ParamEdit): void;
	(ev: 'remove'): void;
	(ev: 'setBypass', bypass: boolean): void;
	(ev: 'setResolution', resolution: EffectResolution): void;
	(ev: 'setDisplayName', displayName: string): void;
}>();

const name = computed(() => getEffectNodeName(props.node, effectDefinitions.value));
const expanded = ref(true);
const showSettings = ref(false);
const allInPortEl = shallowRef<HTMLElement | null>(null);
const effectStatus = computed(() => props.effectState?.status);
const connectedParameterPathKeys = computed(() => {
	const paths = new Set<string>();
	// 未選択のnode入力や削除済みの出力への参照はワイヤーが描画されない。
	// 実際の出力ポートが登録されている接続だけを数え、配下をノードごとに一度だけ走査する。
	for (const { path, value } of walkNodeParams(props.node, effectDefinitions.value)) {
		if (value.inputSource !== 'node' || value.nodeId == null || wireMap.out[value.nodeId]?.[value.outputPort] == null) continue;
		for (let length = 1; length <= path.length; length++) {
			paths.add(paramPathKey([path[0], ...path.slice(1, length)]));
		}
	}
	return paths;
});
provide(connectedNodeParameterPathKeysKey, connectedParameterPathKeys);

const resolutionModes: { value: EffectResolution['mode']; label: string }[] = [
	{ value: 'context', label: i18n.ts._Node.ContextResolution },
	{ value: 'auto', label: i18n.ts.Auto },
	{ value: 'customAbsolute', label: i18n.ts._Node.CustomResolution },
];

function setResolutionMode(mode: EffectResolution['mode']) {
	if (mode === props.node.resolution.mode) return;
	emit('setResolution', mode === 'customAbsolute' ? { mode, ...stateManager.state.resolution.value }
		: { mode, scale: props.node.resolution.mode === 'customAbsolute' ? 1 : props.node.resolution.scale });
}

function setResolutionScale(scale: number | null) {
	if (props.node.resolution.mode === 'customAbsolute' || scale == null || !Number.isFinite(scale) || scale <= 0 || scale === props.node.resolution.scale) return;
	emit('setResolution', { ...props.node.resolution, scale });
}

function setDimension(axis: 'width' | 'height', value: number | null) {
	if (props.node.resolution.mode !== 'customAbsolute' || value == null || !Number.isSafeInteger(value) || value < 1) return;
	emit('setResolution', { ...props.node.resolution, [axis]: value });
}

function showEffectError() {
	if (effectStatus.value?.type !== 'error') return;
	ui.alert({ type: 'error', title: name.value, text: effectStatus.value.message });
}

function onHeaderContextmenu(ev: PointerEvent) {
	ui.contextMenu(getCustomNodeGraphEffectNodeHeaderMenuItems(props.node, name => emit('setDisplayName', name)), ev);
}

function remove() {
	emit('remove');
}

function toggleBypass() {
	emit('setBypass', !props.node.isBypass);
}

watchEffect(onCleanup => {
	const el = allInPortEl.value;
	const nodeId = props.node.id;
	if (el == null) return;
	wireMap.allIn[nodeId] = el;
	onCleanup(() => {
		if (wireMap.allIn[nodeId] === el) delete wireMap.allIn[nodeId];
	});
});
</script>

<style module lang="scss">
.root {
	position: relative;
	background: var(--THEME-nodeBg);
	border-radius: 6px;
	overflow: clip;
	contain: content;

	&.isBypass {
		.params {
			opacity: 0.5;
		}
	}
}

.allInPort {
}

.header {
	display: flex;
	&.hasStatus {
		padding-right: 117px;
	}
	white-space: nowrap;
	overflow: clip;
	height: 32px;
	text-overflow: ellipsis;
	cursor: move;
	background: linear-gradient(0deg, var(--THEME-nodeBg), hsl(from var(--THEME-nodeBg) h s calc(l + 5)));
	//background: var(--THEME-nodeBg);

	&.disabled {
		pointer-events: none;
	}
}

.headerLeft {
	display: flex;
	margin-right: auto;
	padding-left: 8px;
	align-items: center;
	gap: 8px;
}

.headerRight {
	display: flex;
	margin-left: auto;
	align-items: center;
	gap: 8px;
}

.effectName {
	font-weight: bold;
}

.nodeId {
}

.headerButtons {
}

.headerButton {
	display: inline-block;
	width: 23px;
	height: 23px;
	padding-left: 0;
	padding-right: 0;

	&:not(:first-child) {
		margin-left: 6px;
	}
}

.error {
	color: #ff806f;
}

.loading {
	display: inline-block;
	animation: statusSpin 1s linear infinite;
}

@keyframes statusSpin {
	to {
		transform: rotate(360deg);
	}
}

.params {
	&.disabled {
		opacity: 0.7;
		pointer-events: none;
	}
}
</style>
