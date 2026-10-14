<template>
<GsModal ref="modal" :preferType="'dialog'" :zPriority="'high'" @click="success ? done() : () => {}" @closed="emit('closed')">
	<div :class="[$style.root, { [$style.iconOnly]: (text == null) || success }]">
		<i v-if="success" :class="[$style.icon, $style.success]" class="ti ti-check"></i>
		<GsLoading v-else :class="[$style.icon, $style.waiting]" :em="true"/>
		<div v-if="text && !success" :class="$style.text">{{ text }}<GsEllipsis/></div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { watch, useTemplateRef } from 'vue';
import GsModal from './GsModal.vue';
import GsLoading from './GsLoading.vue';
import GsEllipsis from './GsEllipsis.vue';

const modal = useTemplateRef('modal');

const props = defineProps<{
	success: boolean;
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
	width: 250px;

	&.iconOnly {
		padding: 0;
		width: 96px;
		height: 96px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
}

.icon {
	font-size: 32px;

	&.success {
		color: var(--THEME-accent);
	}

	&.waiting {
		opacity: 0.7;
	}
}

.text {
	margin-top: 16px;
}
</style>
