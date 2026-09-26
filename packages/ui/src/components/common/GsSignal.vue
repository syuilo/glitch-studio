<template>
<div :class="$style.root">
	<GsButton style="min-width: 50px;" inline small :primary="r" @click="change('r')"><span style="background-image: linear-gradient(90deg, #f00, #f00, #f00); background-repeat: no-repeat; background-position: 0 100%; background-size: 100% 2px;">R</span></GsButton>
	<GsButton style="min-width: 50px;" inline small :primary="g" @click="change('g')"><span style="background-image: linear-gradient(90deg, #0f0, #0f0, #0f0); background-repeat: no-repeat; background-position: 0 100%; background-size: 100% 2px;">G</span></GsButton>
	<GsButton style="min-width: 50px;" inline small :primary="b" @click="change('b')"><span style="background-image: linear-gradient(90deg, #00f, #00f, #00f); background-repeat: no-repeat; background-position: 0 100%; background-size: 100% 2px;">B</span></GsButton>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import GsButton from './GsButton.vue';

const props = defineProps<{
	signal: [boolean, boolean, boolean];
}>();

const emit = defineEmits<{
	(ev: 'input', signal: [boolean, boolean, boolean]): void;
}>();

const r = computed(() => props.signal[0]);
const g = computed(() => props.signal[1]);
const b = computed(() => props.signal[2]);

function change(color: string) {
	emit('input', [
		color === 'r' ? !r.value : r.value,
		color === 'g' ? !g.value : g.value,
		color === 'b' ? !b.value : b.value,
	]);
}
</script>

<style module lang="scss">
.root {
	display: flex;
	gap: 8px;
}
</style>
