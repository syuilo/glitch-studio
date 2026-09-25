<template>
<div :class="[$style.root, { [$style.isBypass]: node.isBypass }]">
	<div :class="[$style.header, { [$style.hasStatus]: effectStatus?.type === 'loading' || effectStatus?.type === 'error' }]" :draggable="true" @dragstart.stop="emit('dragStart', $event)">
		<div :class="$style.headerLeft">
			<GsNodePort :class="$style.allInPort" dataType="any" @update:element="allInPortEl = $event"/>
			<div :class="$style.effectName">{{ name }}</div>
			<div v-if="effectStatus?.type === 'loading'" :class="$style.headerButton" inline small iconOnly title="Loading…"><i class="ti ti-loader-2" :class="$style.loading"></i></div>
			<div v-else-if="effectStatus?.type === 'error'" :class="[$style.headerButton, $style.error]" inline small iconOnly :title="effectStatus.message" @click.stop="showEffectError"><i class="ti ti-alert-triangle"></i></div>
		</div>
		<div :class="$style.headerRight">
			<div :class="$style.nodeId" class="_monospace">{{ node.id }}</div>
			<div :class="$style.headerButtons">
				<GsButton :class="[$style.headerButton]" inline small iconOnly @click="expanded = !expanded"><i class="ti" :class="expanded ? 'ti-chevron-up' : 'ti-chevron-down'"></i></GsButton>
				<GsButton :class="[$style.headerButton]" inline small iconOnly :primary="!node.isBypass" :title="node.isBypass ? i18n.ts.ClickToEnable : i18n.ts.ClickToDisable" @click="toggleBypass()"><i class="ti" :class="node.isBypass ? 'ti-eye-off' : 'ti-eye'"></i></GsButton>
				<GsButton :class="[$style.headerButton]" inline small iconOnly :title="i18n.ts.RemoveEffect" @click="remove()"><i class="ti ti-x"></i></GsButton>
			</div>
		</div>
	</div>

	<div v-show="expanded" :class="$style.params" :inert="node.isBypass">
		<GsVisualParam
			:availableVariables="moduleEnvVarDefs"
			v-for="[param, def] in Object.entries(getNodeParamDefs(props.node))"
			:key="param"
			:visualModuleId="visualModuleId"
			:automationGraphs="appContext.getVisualModuleById(visualModuleId)?.automationGraphs ?? []"
			:node="node"
			:paramPath="[param]"
			:paramDef="def"
			:paramValue="node.params[param]"
			@edit="onParamEdit"
		/>
	</div>

	<GsNodeOutputs style="margin-top: 4px;" :node="node" :outputResolutions="node.isBypass ? undefined : effectState?.outputs"/>
</div>
</template>

<script lang="ts" setup>
import { moduleEnvVarDefs } from '@glitch/shared/expression.ts';
import { ref, computed, shallowRef, watchEffect } from 'vue';
import { effectDefinitions } from '@glitch/shared/effect/effect-definitions.ts';
import GsNodeOutputs from './GsNodeOutputs.vue';
import GsNodePort from './GsNodePort.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsButton from './common/GsButton.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { GsEffectNode } from '@glitch/shared/types.ts';
import { i18n } from '@/i18n.ts';
import { appContext, engine, wireMap } from '@/app.ts';
import { getNodeParamDefs } from '@/utility/node-params.ts';
import * as ui from '@/ui.ts';

const props = defineProps<{
	visualModuleId: string;
	node: GsEffectNode,
}>();

const emit = defineEmits<{
	(ev: 'dragStart', event: DragEvent): void;
}>();

const name = ref<string>(effectDefinitions[props.node.effectId].displayName);
const expanded = ref(true);
const allInPortEl = shallowRef<HTMLElement | null>(null);
const effectState = computed(() => engine.getLiveEffectState(props.visualModuleId, props.node.id));
const effectStatus = computed(() => effectState.value?.status);

function onParamEdit(event: ParamEdit) {
	const target = { visualModuleId: props.visualModuleId, nodeId: props.node.id, paramPath: event.paramPath };
	switch (event.kind) {
		case 'literal': appContext.commit('updateParamAsLiteral', { ...target, value: event.value }, event.mergeKey); break;
		case 'automationGraphInline': appContext.commit('updateParamAsAutomationGraphInline', { ...target, value: event.value }, event.mergeKey); break;
		case 'envVariable': appContext.commit('updateParamAsEnvVariable', { ...target, value: event.value }); break;
		case 'expression': appContext.commit('updateParamAsExpression', { ...target, value: event.value }, event.mergeKey); break;
		case 'automationGraphReference': appContext.commit('updateParamAsAutomationGraphReference', { ...target, value: event.value, options: event.options }); break;
		case 'node': appContext.commit('updateParamAsNode', { ...target, value: event.value }); break;
		case 'externalCustomParameterInput': appContext.commit('updateParamAsExternalCustomParameterInput', { ...target, value: event.value }); break;
		case 'inputSource': appContext.commit('changeParamValueInputSource', { ...target, inputSource: event.inputSource }); break;
		case 'reset': appContext.commit('resetNodeParam', target); break;
		case 'addElement': appContext.commit('addArrayParamElement', target); break;
		case 'removeElement': appContext.commit('removeArrayParamElement', { ...target, index: event.index }); break;
	}
}

function showEffectError() {
	if (effectStatus.value?.type !== 'error') return;
	void ui.alert({ type: 'error', title: name.value, text: effectStatus.value.message });
}

function remove() {
	appContext.commit('removeNode', {
		visualModuleId: props.visualModuleId,
		nodeId: props.node.id,
	});
}

function toggleBypass() {
	appContext.commit('changeNodeBypassState', {
		visualModuleId: props.visualModuleId,
		nodeId: props.node.id,
		bypass: !props.node.isBypass,
	});
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
