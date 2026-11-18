<template>
<div :class="[$style.root]">
	<div :class="[$style.header]">
		<div :class="$style.headerLeft">
			<b><i class="ti ti-arrow-right"></i> Out</b>
		</div>
	</div>

	<div style="padding: 4px 0;">
		<GsCustomNodeGraphEffectNodeInput
			v-for="def in customNodeGraphEffect.outputDefs"
			:key="def.id"
			:customNodeGraphEffect="customNodeGraphEffect"
			:nodeId="node.id"
			:inputId="def.id"
			:label="def.label"
			:dataType="def.dataType"
			:input="node.inputs[def.id] ?? null"
			@change="value => emit('changeInput', def.id, value)"
		/>
	</div>
</div>
</template>

<script lang="ts" setup>
import GsCustomNodeGraphEffectNodeInput from './GsCustomNodeGraphEffectNodeInput.vue';
import type { NodeOutputReference, CustomNodeGraphEffect, CustomNodeGraphEffectGlobalOutNode } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';

defineProps<{
	customNodeGraphEffect: CustomNodeGraphEffect;
	node: CustomNodeGraphEffectGlobalOutNode
}>();

const emit = defineEmits<{ changeInput: [outputId: string, value: NodeOutputReference | null] }>();
</script>

<style module lang="scss">
.root {
	position: relative;
	background: var(--THEME-nodeBg);
	border-radius: 6px;
	overflow: clip;
	contain: content;
}

.header {
	display: flex;
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
</style>
