<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="ok" @click="ok">
	<div :class="$style.root" class="_gaps_m">
		<div style="font-size: 120%;">
			<img src="/gs.svg" draggable="false" style="display: block; margin: 0 auto 8px auto; width: 60px; height: 60px;">
			<div><b>Glitch Studio{{ isElectron ? '' : ' (for Web)' }}</b></div>
			<div>{{ version }}</div>
		</div>
		<hr>
		<div style="font-size: 120%;">
			<small style="display: block;">
				<div>Copyright (c) 2019-2026 syuilo</div>
				<a class="_gs-link" href="https://github.com/syuilo/glitch-studio" target="_blank">https://github.com/syuilo/glitch-studio</a>
			</small>
		</div>

		<div>
			<a class="_gs-link" href="https://syuilo.dev/glitch-studio/docs/" target="_blank">{{ i18n.ts.UserGuide }}</a>・<a class="_gs-link" href="https://syuilo.dev/" target="_blank">{{ i18n.ts.Donation }}</a>
		</div>
		<hr>
		<GsButton large style="align-self: center;" @click="ok">{{ i18n.ts.OK }}</GsButton>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import { i18n } from '@/i18n.ts';

const version = _VERSION_;
const isElectron = __ELECTRON__;

const modal = useTemplateRef('modal');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

function ok() {
	modal.value!.close();
}
</script>

<style module lang="scss">
.root {
	margin: auto;
	position: relative;
	padding: 28px;
	min-width: 320px;
	max-width: 480px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-dialog);
	border-radius: 10px;
}
</style>
