<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')">
	<div :class="$style.root" class="_gaps_m">
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';

const modal = useTemplateRef('modal');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

</script>

<style module lang="scss">
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	width: 480px;
	box-sizing: border-box;
	background: var(--THEME-dialog);
	border-radius: 10px;
}
</style>
