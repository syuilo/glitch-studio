<template>
<GsModal ref="modal" @closed="emit('closed')">
	<div :class="$style.root" class="_shadow _popup">
		<div :class="$style.header">
			<div :class="$style.actions">
				<div :class="$style.button" title="閉じる" tabindex="0" @click="close" @keydown.enter.prevent="close"><i class="ti ti-x"></i></div>
			</div>
		</div>
		<div :class="$style.body">
			<div :class="$style.leftArea">
			</div>
			<div :class="$style.rightArea">
				<div v-for="[k, effect] in Object.entries(fxDefinitions)" :key="k" :class="$style.effect" @click="emit('chosen', effect)">
					{{ effect.displayName }}
				</div>
			</div>
		</div>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { fxDefinitions } from '@glitch/shared/fx-definitions.js';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import * as ui from '@/ui.ts';

const props = defineProps<{
}>();

const emit = defineEmits<{
	(ev: 'chosen', effect: typeof fxDefinitions[keyof typeof fxDefinitions]): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');

function close() {
	modal.value?.close();
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

.header, .actions, .sliderRow { display: flex; align-items: center; gap: 12px; }
.header { justify-content: space-between; margin-bottom: 6px; padding-left: 4px; }
.actions { gap: 6px; }

.body {
	display: flex;
	flex-direction: row;
	gap: 16px;
}
.leftArea {
	flex: 0.4;
}
.rightArea {
	flex: 0.6;
}

.effect {

}
</style>
