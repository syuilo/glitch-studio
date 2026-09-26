<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')" @esc="close" @click="close">
	<div :class="$style.root" class="_gaps_s" @keydown.stop @keydown.esc.prevent="close">
		<div :class="$style.title">Import local font</div>
		<GsInput v-model="search" autofocus placeholder="Search fonts" :disabled="importing"/>
		<div :class="$style.fonts">
			<GsButton
				v-for="font in filteredFonts" :key="font.postscriptName"
				:active="selectedName === font.postscriptName" :disabled="importing"
				@click="selectedName = font.postscriptName"
			>
				<div :class="$style.fontName">{{ font.fullName }}</div>
				<div :class="$style.detail">{{ font.family }} · {{ font.style }}</div>
			</GsButton>
			<div v-if="filteredFonts.length === 0">{{ fonts.length === 0 ? 'No local fonts are available.' : 'No matching fonts.' }}</div>
		</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
		<div :class="$style.actions">
			<GsButton inline :disabled="importing" @click="close">Cancel</GsButton>
			<GsButton inline primary :disabled="!selectedFont || importing" :wait="importing" @click="importFont">Import</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue';
import { genId } from '@glitch/shared/utility/id.ts';
import GsModal from './common/GsModal.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import type { LocalFont } from '@/utility/local-fonts.ts';
import { localFontErrorMessage } from '@/utility/local-fonts.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ fonts: LocalFont[] }>();
const emit = defineEmits<{ (ev: 'closed'): void }>();
const modal = useTemplateRef('modal');
const search = ref('');
const selectedName = ref<string | null>(null);
const importing = ref(false);
const error = ref<string | null>(null);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

const filteredFonts = computed(() => {
	const query = search.value.trim().toLocaleLowerCase();
	return props.fonts.filter(font => `${font.family} ${font.fullName} ${font.style} ${font.postscriptName}`.toLocaleLowerCase().includes(query));
});
// 検索で非表示になった選択を誤って取り込まない。
const selectedFont = computed(() => filteredFonts.value.find(font => font.postscriptName === selectedName.value));

function close() {
	if (!importing.value) modal.value?.close();
}

async function importFont() {
	const font = selectedFont.value;
	if (!font || importing.value) return;
	importing.value = true;
	error.value = null;
	try {
		// 一覧取得では名前だけを使い、選択したフォントの原本だけを取得・保存する。
		// blob()はSFNTを返す。MIMEが空でもfontAssetReferenceから参照できるよう統一する。
		const blob = await font.blob();
		if (disposed) return;
		if (blob.size === 0) throw new Error('The selected font contains no data.');
		appContext.commit('addAsset', {
			id: genId(),
			name: font.fullName,
			width: 0,
			height: 0,
			data: null,
			fileDataType: 'font/sfnt',
			fileData: blob.slice(0, blob.size, 'font/sfnt'),
		});
		modal.value?.close();
	} catch (cause) {
		if (!disposed) error.value = localFontErrorMessage(cause);
	} finally {
		importing.value = false;
	}
}
</script>

<style module lang="scss">
.root {
	width: min(520px, 90vw);
	padding: 24px;
	box-sizing: border-box;
	background: var(--THEME-panel);
	border-radius: 12px;
}

.title {
	font-weight: bold;
}

.fonts {
	display: flex;
	flex-direction: column;
	gap: 6px;
	height: min(400px, 50vh);
	overflow: auto;
	> * { flex-shrink: 0; }
}

.fontName {
	overflow-wrap: anywhere;
}

.detail {
	font-size: 85%;
	opacity: 0.7;
}

.error {
	color: var(--THEME-error, #f88);
}

.actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
