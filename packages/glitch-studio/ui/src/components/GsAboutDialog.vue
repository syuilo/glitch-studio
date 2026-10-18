<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')">
	<div :class="$style.root" class="_gaps_m">
		<div style="font-size: 110%;">
			<img src="/gs.svg" draggable="false" style="display: block; margin: 0 auto 8px auto; width: 64px; height: 64px;">
			<div><b>Glitch Studio{{ isElectron ? '' : ' (for Web)' }}</b></div>
			<div>{{ version }}</div>
		</div>
		<div style="font-size: 110%;">
			<small style="display: block;">
				<div>Copyright (c) 2019-2026 syuilo</div>
				<a class="_gs-link" href="https://github.com/syuilo/glitch-studio" target="_blank">https://github.com/syuilo/glitch-studio</a>
			</small>
		</div>
		<div style="font-size: 110%;">
			<small style="display: block;">
				<div>{{ i18n.ts._About.MisskeyCredit }}</div>
				<a class="_gs-link" href="https://github.com/misskey-dev/misskey" target="_blank">https://github.com/misskey-dev/misskey</a>
			</small>
		</div>
		<a class="_gs-link" href="https://syuilo.dev/glitch-studio/docs/" target="_blank">{{ i18n.ts.UserGuide }}</a>
		<GsButton large inline @click="ok">{{ i18n.ts.OK }}</GsButton>
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
	padding: 32px;
	min-width: 320px;
	max-width: 480px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-dialog);
	border-radius: 10px;
}
</style>
