<template>
<GsModal ref="modal" :preferType="'dialog'" :zPriority="'high'" @closed="emit('closed')">
	<div :class="[$style.root]">
		<div v-if="text" :class="$style.text">{{ text }}<GsEllipsis/></div>
		<GsProgressBar :progress="props.progress"/>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef } from 'vue';
import GsModal from './GsModal.vue';
import GsProgressBar from './GsProgressBar.vue';
import GsEllipsis from './GsEllipsis.vue';

const modal = useTemplateRef('modal');

const props = defineProps<{
	progress: number;
	showing: boolean;
	text?: string | null;
}>();

const emit = defineEmits<{
	(ev: 'done'): void;
	(ev: 'closed'): void;
}>();

function done() {
	emit('done');
	modal.value?.close();
}

watch(() => props.showing, () => {
	if (!props.showing) done();
});
</script>

<style lang="scss" module>
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-panel);
	border-radius: 8px;
	width: 300px;
}

.text {
	margin-bottom: 16px;
}
</style>
