<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')">
	<div :class="$style.root" class="_gaps_m">
		<div style="font-size: 110%;">
			<img src="/gs.svg" style="display: block; margin: 0 auto 8px auto; width: 64px; height: 64px;">
			<div><b>Glitch Studio</b></div>
			<div>{{ version }}</div>
		</div>
		<div style="font-size: 110%;">
			<small style="display: block;">
				<div>Copyright (c) 2024-2026 syuilo</div>
				<a class="_gs-link" href="https://github.com/syuilo/glitch-studio" target="_blank">https://github.com/syuilo/glitch-studio</a>
			</small>
		</div>
		<div style="font-size: 110%;">
			<small style="display: block;">
				<div>UIなど一部の実装はMisskeyから移植しています</div>
				<a class="_gs-link" href="https://github.com/misskey-dev/misskey" target="_blank">https://github.com/misskey-dev/misskey</a>
			</small>
		</div>
		<GsButton v-if="isElectron" inline :wait="showingTestAlert" @click="showTestAlert">OSダイアログをテスト</GsButton>
		<GsButton v-if="isElectron" inline @click="openDevTools">開発者ツールを開く</GsButton>
		<GsButton inline @click="ok">OK</GsButton>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef } from 'vue';
import GsModal from './common/GsModal.vue';
import GsButton from './common/GsButton.vue';
import * as ui from '@/ui.ts';

const version = _VERSION_;
const isElectron = __ELECTRON__;
const showingTestAlert = ref(false);

async function showTestAlert() {
	if (!__ELECTRON__ || showingTestAlert.value) return;
	showingTestAlert.value = true;
	try {
		if (!window.desktop) throw new Error('Desktop API is unavailable');
		await window.desktop.showTestAlert();
	} catch (error) {
		await ui.alert({ type: 'error', title: 'OSダイアログの表示に失敗しました', text: String(error) });
	} finally {
		showingTestAlert.value = false;
	}
}

async function openDevTools() {
	if (!__ELECTRON__) return;
	try {
		if (!window.desktop) throw new Error('Desktop API is unavailable');
		await window.desktop.openDevTools();
	} catch (error) {
		await ui.alert({ type: 'error', title: '開発者ツールを開けませんでした', text: String(error) });
	}
}

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
