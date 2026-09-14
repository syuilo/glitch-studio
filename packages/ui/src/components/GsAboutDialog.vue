<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')">
	<div :class="$style.root" class="_gaps_m">
		<div style="font-size: 110%;">
			<img src="/gs.svg" style="display: block; margin: 0 auto 8px auto; width: 64px; height: 64px;">
			<div><b>Glitch Studio for Web</b></div>
			<div>{{ version }}</div>
		</div>
		<div style="font-size: 110%;">
			<small style="display: block;">
				<div>Copyright (c) 2024-2026 syuilo</div>
				<a class="_gs-link" href="https://github.com/syuilo/glitch-studio-web" target="_blank">https://github.com/syuilo/glitch-studio-web</a>
			</small>
		</div>
		<div style="font-size: 110%;">
			<small style="display: block;">
				<div>UIなど一部の実装はMisskeyから移植しています</div>
				<a class="_gs-link" href="https://github.com/misskey-dev/misskey" target="_blank">https://github.com/misskey-dev/misskey</a>
			</small>
		</div>
		<GsButton inline @click="ok">OK</GsButton>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';

const version = _VERSION_;

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
