<template>
<component :is="popup.component" v-for="popup in ui.popups.value" :key="popup.id" v-bind="popup.props" v-on="popup.events"/>
<div style="position: relative; width: 460px; margin: 40px;">
	<GsFxNode v-for="node in nodes" :key="node.id" :node="node" :group="null" style="margin-bottom: 24px;"/>
	<GsWires/>
</div>
<div style="margin: 40px;">
	<button @click="appContext.undo()">Undo</button>
	<button @click="appContext.redo()">Redo</button>
	<pre>{{ nodes.at(-1)?.params }}</pre>
</div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { fxDefinitions } from '@glitch/shared/fx-definitions.ts';
import type { GsFxNode as FxNode } from '@glitch/shared/types.ts';
import { appContext } from '../src/app.ts';
import * as ui from '../src/ui.ts';
import GsFxNode from '../src/components/GsFxNode.vue';
import GsWires from '../src/components/GsWires.vue';

// UIだけを実物のコンポーネントで確認する。レンダラーへのテスト用エフェクトの登録は不要。
fxDefinitions.multiOutputFixture = {
	name: 'multiOutputFixture', displayName: 'Multi', paramDefs: {},
	outputs: { output: { dataType: 'color', primary: true }, subOutput: { dataType: 'scalar', primary: false } },
};
appContext.commit('addFxNode', { id: 'fooNode', fx: 'fill' });
appContext.commit('addFxNode', { id: 'barNode', fx: 'multiOutputFixture' });
appContext.commit('addFxNode', { id: 'consumer', fx: 'blur' });
const nodes = computed(() => appContext.state.nodes.value as FxNode[]);
</script>
