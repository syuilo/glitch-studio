<template>
<GsModal ref="modal" @closed="emit('closed')">
	<div :class="$style.root" class="_shadow _popup">
		<div :class="$style.header">
			<GsInput ref="searchInput" v-model="query" type="search" :class="$style.searchInput"/>
			<div :class="$style.actions">
				<div :class="$style.button" title="閉じる" tabindex="0" @click="close" @keydown.enter.prevent="close"><i class="ti ti-x"></i></div>
			</div>
		</div>
		<div :class="$style.body">
			<div :class="$style.leftArea">
			</div>
			<div :class="$style.rightArea">
				<div :class="$style.effects">
					<button v-for="[k, effect] in results" :key="k" class="_button" :class="$style.effect" @click="choose(effect)">
						{{ effect.displayName }}
					</button>
				</div>
			</div>
		</div>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { effectDefinitions } from '@glitch/shared/effect-definitions.js';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import * as ui from '@/ui.ts';

const props = defineProps<{
}>();

const emit = defineEmits<{
	(ev: 'chosen', effect: typeof effectDefinitions[keyof typeof effectDefinitions]): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const searchInput = useTemplateRef('searchInput');

const query = ref('');

const results = computed(() => {
	return Object.entries(effectDefinitions).filter(([k, effect]) => {
		return effect.displayName.toLowerCase().includes(query.value.toLowerCase());
	});
});

function close() {
	modal.value?.close();
}

function choose(effect: typeof effectDefinitions[keyof typeof effectDefinitions]) {
	emit('chosen', effect);
	close();
}

onMounted(() => {
	searchInput.value?.focus();
});
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	margin: auto;
	position: relative;
	width: 1200px;
	max-width: 100%;
	height: 100%;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.header, .actions, .sliderRow { display: flex; align-items: center; gap: 12px; }
.header { justify-content: space-between; margin-bottom: 6px; padding-left: 4px; }
.actions { gap: 6px; }

.header {
	padding: 16px;
}

.searchInput {
	width: 100%;
}

.body {
	flex: 1;
	display: flex;
	flex-direction: row;
	gap: 16px;
}
.leftArea {
	flex: 0.3;
}
.rightArea {
	flex: 0.7;
	overflow: auto;
}

.effects {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 16px;
}

.effect {
	padding: 8px;
	background: light-dark(#0001, #fff1);
	border-radius: 6px;
}
</style>
