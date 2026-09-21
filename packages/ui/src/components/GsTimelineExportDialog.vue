<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')">
	<div :class="$style.root">
		<GsButton inline @click="cancel">Cancel</GsButton>
		<GsButton inline primary @click="doExport">EXPORT</GsButton>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import * as ui from '@/ui.ts';

const modal = useTemplateRef('modal');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

function cancel() {
	modal.value!.close();
}
</script>

<style module lang="scss">
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	min-width: 320px;
	max-width: 480px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-dialog);
	border-radius: 10px;
}
</style>
