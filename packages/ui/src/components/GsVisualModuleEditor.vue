<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;" @click="showSwitchMenu"><i class="ti ti-chevron-down"></i> Module: {{ visualModule?.name ?? '' }} [{{ visualModule?.id ?? '' }}]</button>
		<GsButton :class="$style.liveButton" small primary @click="previewLive"><i class="ti ti-player-play"></i> LIVE</GsButton>

		<GsButton small primary @click="addAutomation">a</GsButton>

		<div style="padding: 8px;">
			<GsTabs
				v-model="tab" :def="[{
					id: 'nodes',
					label: 'Nodes',
				},{
					id: 'paramDefs',
					label: 'Param Defs',
				},{
					id: 'paramPreview',
					label: 'Param Preview',
				},{
					id: 'outputDefs',
					label: 'Output Defs',
				},{
					id: 'other',
					label: 'Other',
				}]"
			>
			</GsTabs>
		</div>
	</div>

	<div v-if="visualModule != null" :key="visualModule.id" style="flex: 1; min-height: 0;">
		<div v-if="tab === 'nodes'" style="height: 100%; overflow: auto; background: var(--THEME-bg);">
			<div :class="$style.nodesContent" class="_gaps_s">
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
						<XEffectNode v-if="node.type === 'effect'" :visualModuleId="visualModule.id" :node="node" :class="$style.node" @dragStart="dragStart"/>
					</template>
					<template #footer>
						<GsButton :class="$style.addButton" full style="margin-top: 8px;" @click="showAddNodeMenu(visualModule.id, $event)"><i class="ti ti-plus"></i> Add node...</GsButton>
					</template>
				</GsDraggable>

				<hr>

				<XGlobalOutNode v-if="globalOutNode" :node="globalOutNode" :visualModuleId="visualModule.id" :class="$style.node"/>

				<GsWires :visualModuleId="visualModule.id"/>
			</div>
		</div>

		<div v-if="tab === 'paramDefs'" style="height: 100%; overflow: auto;">
			<XVisualModuleParamDefsEditor :visualModule="visualModule"/>
		</div>

		<div v-if="tab === 'paramPreview'" style="height: 100%; overflow: auto;">
			<div :class="$style.previewParams">
				<GsVisualParam
					v-for="paramDef of visualModule.paramDefs"
					:key="paramDef.id"
					:paramPath="[paramDef.id]"
					:paramDef="{ ...paramDef, canNode: false }"
					:paramValue="previewParamValues[paramDef.id]"
					@edit="onPreviewParamEdit"
				/>
			</div>
		</div>

		<div v-if="tab === 'outputDefs'" style="height: 100%; overflow: auto;">
			<XVisualModuleOutputDefsEditor :visualModule="visualModule"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { genId } from '@glitch/shared/utility/id.js';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsVisualParam from './GsVisualParam.vue';
import XEffectNode from './GsEffectNode.vue';
import XGlobalInNode from './GsGlobalInNode.vue';
import XGlobalOutNode from './GsGlobalOutNode.vue';
import XVisualModuleParamDefsEditor from './XVisualModuleParamDefsEditor.vue';
import XVisualModuleOutputDefsEditor from './XVisualModuleOutputDefsEditor.vue';
import GsTabs from './common/GsTabs.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { GsAutomation, GsGlobalInNode, GsGlobalOutNode, GsNode, VisualModule, VisualModuleParamValues } from '@glitch/shared/types.js';
import { showAddNodeMenu } from '@/app.ts';
import { appContext, engine } from '@/app.ts';
import * as ui from '@/ui.ts';

const tab = ref('nodes');
const visualModule = ref<VisualModule | null>();
const previewParamValues = ref<VisualModuleParamValues>({});
let previewModuleId: string | undefined;
let previewParamTypes = new Map<string, VisualModule['paramDefs'][number]['dataType']>();

watch(appContext.state.visualModules, () => {
	const module = appContext.state.visualModules.value.find(module => module.id === visualModule.value?.id) ?? appContext.state.visualModules.value[0];
	visualModule.value = module ?? null;
}, { deep: true, immediate: true });

watch(visualModule, module => {
	const values: VisualModuleParamValues = {};
	for (const def of module?.paramDefs ?? []) {
		// ノードの編集などでプレビューの入力値を初期化しない。
		values[def.id] = module?.id === previewModuleId && previewParamTypes.get(def.id) === def.dataType && previewParamValues.value[def.id] != null
			? previewParamValues.value[def.id]
			: deepClone(def.defaultValue);
	}
	previewParamValues.value = values;
	previewModuleId = module?.id;
	previewParamTypes = new Map((module?.paramDefs ?? []).map(def => [def.id, def.dataType]));
}, { deep: true, immediate: true });

function onPreviewParamEdit(event: ParamEdit) {
	// VisualModuleのパラメータ定義は現在フラットで、array/structは持たない。
	if (event.paramPath.length !== 1) return;
	const id = event.paramPath[0];
	const def = visualModule.value?.paramDefs.find(def => def.id === id);
	if (def == null) return;
	const current = previewParamValues.value[id];
	const reset = (): VisualModuleParamValues[string] => deepClone(def.defaultValue);
	switch (event.kind) {
		case 'literal': previewParamValues.value[id] = { inputSource: 'literal', value: deepClone(event.value) }; break;
		case 'envVariable': previewParamValues.value[id] = { inputSource: 'envVariable', variable: event.value }; break;
		case 'expression': previewParamValues.value[id] = { inputSource: 'expression', expression: event.value }; break;
		case 'automationReference': previewParamValues.value[id] = { inputSource: 'automationReference', durationMs: 1000, playMode: 'repeat', ...(current?.inputSource === 'automationReference' ? current : {}), automationId: event.value }; break;
		case 'node':
		case 'externalParameterInput': return;
		case 'reset': previewParamValues.value[id] = reset(); break;
		case 'inputSource':
			switch (event.inputSource) {
				case 'literal': previewParamValues.value[id] = reset(); break;
				case 'expression': previewParamValues.value[id] = {
					inputSource: 'expression', expression: AiSON.stringify(current?.inputSource === 'literal' ? current.value : def.defaultValue.value),
				}; break;
				case 'automationReference': previewParamValues.value[id] = { inputSource: 'automationReference', automationId: null, durationMs: 1000, playMode: 'repeat' }; break;
				case 'externalParameterInput':
				case 'node':
					return;
			}
			break;
		case 'addElement':
		case 'removeElement':
			return;
	}
	previewLive();
}

function previewLive() {
	if (visualModule.value == null) return;
	engine.updateLiveParamValues(visualModule.value.id, previewParamValues.value);
}

const globalInNode = computed(() => {
	return visualModule.value?.nodes.find((node): node is GsGlobalInNode => node.type === 'globalIn');
});

const globalOutNode = computed(() => {
	return visualModule.value?.nodes.find((node): node is GsGlobalOutNode => node.type === 'globalOut');
});

function onSorted(nodes: GsNode[]) {
	const module = visualModule.value;
	if (module == null) return;
	// グローバル入出力の位置を維持し、並べ替えられたノードだけを移動する。
	const indices = module.nodes.flatMap((node, index) => node.type === 'effect' ? [index] : []);
	for (const [index, node] of nodes.entries()) {
		if (module.nodes[indices[index]]?.id === node.id) continue;
		appContext.commit('moveNode', { visualModuleId: module.id, nodeId: node.id, index: indices[index] });
	}
}

function showSwitchMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'New',
		icon: 'ti ti-plus',
		action: () => {

		},
	}, {
		type: 'divider',
	}, ...appContext.state.visualModules.value.map(_visualModule => ({
		text: _visualModule.name,
		active: _visualModule.id === visualModule.value?.id,
		action: () => {
			visualModule.value = _visualModule;
		},
	}))], ev.currentTarget ?? ev.target);
}

import GsAutomationEditorWindow from './GsAutomationEditorWindow.vue';

async function addAutomation() {
	const id = genId();
	const automation: GsAutomation = {
		id: id,
		name: 'kf_' + id,
		isNormalized: false,
		keyframes: [{
			id: genId(),
			x: 0,
			y: 0,
			bezierControlPointA: [0, 0],
			bezierControlPointB: [0.5, 0],
		}, {
			id: genId(),
			x: 1,
			y: 1,
			bezierControlPointA: [-0.5, 0],
			bezierControlPointB: [0, 0],
		}],
	};

	const { dispose } = ui.popup(GsAutomationEditorWindow, {
		automation: automation,
	}, {
		done: () => {
		},
		closed: () => dispose(),
	});
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.header {
	position: relative;
}

.liveButton {
	position: absolute;
	top: 8px;
	right: 8px;
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
