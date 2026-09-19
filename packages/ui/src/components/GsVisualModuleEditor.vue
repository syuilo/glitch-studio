<template>
<div :class="$style.root">
	<div :class="$style.header">
		<button class="_button" style="padding: 4px 6px;"><i class="ti ti-chevron-down"></i> Module: {{ visualModule?.name ?? '' }} [{{ visualModule?.id ?? '' }}]</button>
		<div v-if="visualModule != null">
			Graph / Param Defs / Param Preview
		</div>
		<div v-if="visualModule != null && false">
			<XVisualModuleParamDefsEditor :visualModule="visualModule"/>
			<div>Preview:</div>
			<div :class="$style.previewParams">
				<GsVisualParam
					v-for="paramDef of visualModule.paramDefs"
					:key="paramDef.id"
					:paramPath="[paramDef.id]"
					:paramDef="paramDef"
					:paramValue="previewParamValues[paramDef.id]"
					@edit="onPreviewParamEdit"
				/>
			</div>
		</div>
	</div>
	<div v-if="visualModule != null" :key="visualModule.id" :class="$style.nodesContainer">
		<div :class="$style.nodesContent" class="_gaps_s">
			<GsDraggable
				:modelValue="globalInNodes"
				direction="vertical"
				manualDragStart
				withGaps
				@update:modelValue="onSorted"
			>
				<template #default="{ item: node, dragStart }">
					<XGlobalInNode :visualModule="visualModule" :node="node" :class="$style.node"/>
				</template>
			</GsDraggable>

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
					<GsButton :class="$style.addButton" full style="margin-top: 4px;" @click="showAddNodeMenu(visualModule.id, $event)"><i class="ti ti-plus"></i> Add node...</GsButton>
				</template>
			</GsDraggable>

			<hr>

			<GsDraggable
				:modelValue="globalOutNodes"
				direction="vertical"
				manualDragStart
				withGaps
				@update:modelValue="onSorted"
			>
				<template #default="{ item: node, dragStart }">
					<XGlobalOutNode :node="node" :visualModuleId="visualModule.id" :class="$style.node"/>
				</template>
			</GsDraggable>

			<GsWires :visualModuleId="visualModule.id"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { AiSON } from '@syuilo/aiscript';
import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import GsWires from './GsWires.vue';
import GsButton from './common/GsButton.vue';
import GsDraggable from './common/GsDraggable.vue';
import GsVisualParam from './GsVisualParam.vue';
import XEffectNode from './GsEffectNode.vue';
import XGlobalInNode from './GsGlobalInNode.vue';
import XGlobalOutNode from './GsGlobalOutNode.vue';
import XVisualModuleParamDefsEditor from './XVisualModuleParamDefsEditor.vue';
import type { ParamEdit } from './GsVisualParam.vue';
import type { EffectParamValue, GsGlobalInNode, GsGlobalOutNode, GsNode, VisualModule } from '@glitch/shared/types.js';
import { showAddNodeMenu } from '@/app.ts';
import { appContext } from '@/app.ts';

const visualModule = ref<VisualModule | null>();
const previewParamValues = ref<Record<string, EffectParamValue>>({});
let previewModuleId: string | undefined;
let previewParamTypes = new Map<string, VisualModule['paramDefs'][number]['type']>();

watch(appContext.state.visualModules, () => {
	const module = appContext.state.visualModules.value[0];
	visualModule.value = module ?? null;
	const values: Record<string, EffectParamValue> = {};
	for (const def of module?.paramDefs ?? []) {
		// ノードの編集などでプレビューの入力値を初期化しない。
		values[def.id] = module?.id === previewModuleId && previewParamTypes.get(def.id) === def.type && previewParamValues.value[def.id] != null
			? previewParamValues.value[def.id]
			: { type: 'literal', value: deepClone(def.defaultValue) };
	}
	previewParamValues.value = values;
	previewModuleId = module?.id;
	previewParamTypes = new Map((module?.paramDefs ?? []).map(def => [def.id, def.type]));
}, { deep: true, immediate: true });

function onPreviewParamEdit(event: ParamEdit) {
	// VisualModuleのパラメータ定義は現在フラットで、array/structは持たない。
	if (event.paramPath.length !== 1) return;
	const id = event.paramPath[0];
	const def = visualModule.value?.paramDefs.find(def => def.id === id);
	if (def == null) return;
	const current = previewParamValues.value[id];
	const reset = (): EffectParamValue => ({ type: 'literal', value: deepClone(def.defaultValue) });
	switch (event.kind) {
		case 'literal': previewParamValues.value[id] = { type: 'literal', value: deepClone(event.value) }; break;
		case 'expression': previewParamValues.value[id] = { type: 'expression', expression: event.value }; break;
		case 'automation': previewParamValues.value[id] = { type: 'automation', automationId: event.value }; break;
		case 'node':
			if (def.canNode) previewParamValues.value[id] = event.value == null
				? { type: 'node', nodeId: null, outputPort: null }
				: { type: 'node', ...deepClone(event.value) };
			break;
		case 'macro': previewParamValues.value[id] = { type: 'macro', macroId: event.value }; break;
		case 'reset': previewParamValues.value[id] = reset(); break;
		case 'type':
			switch (event.type) {
				case 'literal': previewParamValues.value[id] = reset(); break;
				case 'expression': previewParamValues.value[id] = {
					type: 'expression', expression: AiSON.stringify(current?.type === 'literal' ? current.value : def.defaultValue),
				}; break;
				case 'automation': previewParamValues.value[id] = { type: 'automation', automationId: null }; break;
				case 'macro': previewParamValues.value[id] = { type: 'macro', macroId: '' }; break;
				case 'node':
					if (def.canNode) previewParamValues.value[id] = { type: 'node', nodeId: null, outputPort: null };
					break;
			}
			break;
		case 'addElement':
		case 'removeElement':
			break;
	}
}

const globalInNodes = computed(() => {
	return visualModule.value?.nodes.filter((node): node is GsGlobalInNode => node.type === 'globalIn');
});

const globalOutNodes = computed(() => {
	return visualModule.value?.nodes.filter((node): node is GsGlobalOutNode => node.type === 'globalOut');
});

function onSorted(nodes: GsNode[]) {
	// TODO
	appContext.commit('moveNode', {
		visualModuleId: visualModule.value.id,
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
}

.nodesContainer {
	flex: 1;
	overflow: auto;
	background: var(--THEME-bg);
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
