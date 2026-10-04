<template>
<div :class="[$style.root, { [$style.isBypass]: node.isBypass }]">
	<div :class="[$style.header, { [$style.hasStatus]: effectStatus?.type === 'loading' || effectStatus?.type === 'error' }]" :draggable="true" @dragstart.stop="emit('dragStart', $event)">
		<div :class="$style.headerLeft">
			<GsNodePort v-show="!expanded" :class="$style.allInPort" :dataType="{ kind: 'any' }" @update:element="allInPortEl = $event"/>
			<div :class="$style.effectName">{{ name }}</div>
			<div v-if="effectStatus?.type === 'loading'" :class="$style.headerButton" inline small iconOnly title="Loading…"><i class="ti ti-loader-2" :class="$style.loading"></i></div>
			<div v-else-if="effectStatus?.type === 'error'" :class="[$style.headerButton, $style.error]" inline small iconOnly :title="effectStatus.message" @click.stop="showEffectError"><i class="ti ti-alert-triangle"></i></div>
		</div>
		<div :class="$style.headerRight">
			<div :class="$style.nodeId" class="_monospace">{{ node.id }}</div>
			<div :class="$style.headerButtons">
				<GsButton transparent :class="[$style.headerButton]" inline small iconOnly @click="expanded = !expanded"><i class="ti" :class="expanded ? 'ti-chevron-up' : 'ti-chevron-down'"></i></GsButton>
				<GsButton :transparent="!showSettings" :class="[$style.headerButton]" inline small iconOnly :primary="showSettings" @click="showSettings = !showSettings"><i class="ti ti-settings"></i></GsButton>
				<GsButton :transparent="node.isBypass" :class="[$style.headerButton]" inline small iconOnly :primary="!node.isBypass" :title="node.isBypass ? i18n.ts.ClickToEnable : i18n.ts.ClickToDisable" @click="toggleBypass()"><i class="ti" :class="node.isBypass ? 'ti-eye-off' : 'ti-eye'"></i></GsButton>
				<GsButton transparent :class="[$style.headerButton]" inline small iconOnly :title="i18n.ts.RemoveEffect" @click="remove()"><i class="ti ti-x"></i></GsButton>
			</div>
		</div>
	</div>

	<div v-show="expanded" :class="$style.params" :inert="node.isBypass">
		<div v-if="showSettings" class="_spacer">
			<GsFolder defaultOpen>
				<template #label>Settings</template>

				<div class="_gaps_s">
					<GsSelect :modelValue="node.resolution.mode" :items="resolutionModes" @update:modelValue="setResolutionMode">
						<template #label>Resolution</template>
						<template v-if="node.resolution.mode === 'context'" #caption>Uses the project size in LIVE and the containing scene size in the timeline.</template>
					</GsSelect>
					<div v-if="node.resolution.mode === 'customAbsolute'" style="display: flex; gap: 8px;">
						<GsInput style="flex: 1" type="number" :modelValue="node.resolution.width" :min="1" :step="1" :debounce="400" @update:modelValue="setDimension('width', $event)"><template #label>Width</template><template #suffix>px</template></GsInput>
						<GsInput style="flex: 1" type="number" :modelValue="node.resolution.height" :min="1" :step="1" :debounce="400" @update:modelValue="setDimension('height', $event)"><template #label>Height</template><template #suffix>px</template></GsInput>
					</div>
				</div>
			</GsFolder>
		</div>

		<GsVisualParam
			v-for="[param, def] in Object.entries(getNodeParamDefs(props.node))"
			:key="param"
			:availableVariables="IN_VISUAL_MODULE_VAR_DEFS"
			:visualModule="visualModule"
			:automationGraphs="visualModule.automationGraphs"
			:node="node"
			:paramPath="[param]"
			:paramDef="def"
			:paramValue="node.params[param]"
			@edit="emit('editParam', $event)"
		/>
	</div>

	<GsNodeOutputs style="margin-top: 4px;" :node="node" :outputResolutions="node.isBypass ? undefined : effectState?.outputs"/>
</div>
</template>

<script lang="ts" setup>
import { IN_VISUAL_MODULE_VAR_DEFS } from '@gs/subsystems_visual-module_shared/expression.ts';
import { ref, computed, shallowRef, watchEffect } from 'vue';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import GsNodeOutputs from './GsNodeOutputs.vue';
import GsNodePort from './GsNodePort.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsButton from './common/GsButton.vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsFolder from './common/GsFolder.vue';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { VisualModule, VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectInstanceState } from '@gs/subsystems_effect_shared/effect-status.ts';
import { appStateManager } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import { useVisualModuleWires } from '@/utility/visual-module-wires.ts';
import { getNodeParamDefs } from '@/utility/node-params.ts';
import * as ui from '@/ui.ts';

const wireMap = useVisualModuleWires();

const props = defineProps<{
	visualModule: VisualModule;
	node: VisualModuleEffectNode;
	effectState?: EffectInstanceState;
}>();

const emit = defineEmits<{
	(ev: 'dragStart', event: DragEvent): void;
	(ev: 'editParam', event: ParamEdit): void;
	(ev: 'remove'): void;
	(ev: 'setBypass', bypass: boolean): void;
	(ev: 'setResolution', resolution: EffectResolution): void;
}>();

const name = computed(() => effectDefinitions[props.node.effectId].displayName);
const expanded = ref(true);
const showSettings = ref(false);
const allInPortEl = shallowRef<HTMLElement | null>(null);
const effectStatus = computed(() => props.effectState?.status);

const resolutionModes: { value: EffectResolution['mode']; label: string }[] = [
	{ value: 'context', label: 'Context resolution' },
	{ value: 'auto', label: 'Auto' },
	{ value: 'customAbsolute', label: 'Custom (Absolute)' },
];

function setResolutionMode(mode: EffectResolution['mode']) {
	if (mode === props.node.resolution.mode) return;
	emit('setResolution', mode === 'customAbsolute' ? { mode, ...appStateManager.state.resolution.value } : { mode });
}

function setDimension(axis: 'width' | 'height', value: number | null) {
	if (props.node.resolution.mode !== 'customAbsolute' || value == null || !Number.isSafeInteger(value) || value < 1) return;
	emit('setResolution', { ...props.node.resolution, [axis]: value });
}

function showEffectError() {
	if (effectStatus.value?.type !== 'error') return;
	void ui.alert({ type: 'error', title: name.value, text: effectStatus.value.message });
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
	&.hasStatus { padding-right: 117px; }
	white-space: nowrap;
	overflow: clip;
	height: 32px;
	text-overflow: ellipsis;
	font-size: 95%;
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
	font-size: 90%;
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
	to { transform: rotate(360deg); }
}

.params {
	&.disabled {
		opacity: 0.7;
		pointer-events: none;
	}
}
</style>
