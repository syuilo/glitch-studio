<template>
<div :class="$style.root">
	<div :class="$style.tabs">
		<div v-for="tab in props.def" :key="tab.id" :class="[$style.tab, { [$style.active]: tab.id === props.modelValue }]" @pointerdown="emit('update:modelValue', tab.id)">
			<i v-if="tab.icon" :class="tab.icon"></i> {{ tab.label }}
		</div>
	</div>

	<slot :name="props.modelValue"></slot>
</div>
</template>

<script lang="ts" setup generic="T extends { id: string; label: string; icon?: string }">
import { computed, ref, useTemplateRef, watch } from 'vue';

const props = withDefaults(defineProps<{
	def: T[];
	modelValue: T['id'];
}>(), {
});

const emit = defineEmits<{
	(ev: 'update:modelValue', value: T['id']): void;
}>();

</script>

<style module lang="scss">
.root {

}

.tabs {
	display: flex;
	flex-direction: row;
	gap: 8px;
}

.tab {
	position: relative;
	padding: 4px 8px;
	cursor: pointer;
}

.active {
	&:before {
		content: "";
    display: block;
    position: absolute;
    bottom: 0px;
    left: 0;
    width: 100%;
    height: 2px;
    pointer-events: none;
		background-color: var(--THEME-accent);
	}
}
</style>
