<template>
<div :class="$style.root">
	<button
		v-tooltip="i18n.ts._Preview.GamutCompressionHint"
		:class="[$style.mode, active ? '_buttonPrimaryFg' : '_button']"
		:data-test-preview-gamut-active="active"
		data-test-preview-gamut-mode
		@click="showMenu"
	>
		<i class="ti ti-color-filter"></i> {{ modeLabel }} <i class="ti ti-chevron-down"></i>
	</button>
	<div v-if="previewGamutCompression.mode === 'custom'" :class="$style.amount">
		<input
			v-tooltip="i18n.ts._Preview.GamutCompressionAmountHint"
			:class="$style.input"
			type="number"
			min="0"
			max="100"
			step="1"
			:value="customPercentage"
			data-test-preview-gamut-amount
			@input="onAmountInput"
			@blur="onAmountBlur"
			@keydown.stop
		>
		<span>%</span>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { PreviewGamutCompressionMode } from '@gs/glitch-studio_shared/preview-gamut-compression.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

const { previewGamutCompression } = appContext;
const modes: PreviewGamutCompressionMode[] = ['none', 'displayP3', 'rec2020', 'adobeRgb', 'custom'];
const labels = computed<Record<PreviewGamutCompressionMode, string>>(() => ({
	none: i18n.ts._Preview.GamutCompressionNormal,
	displayP3: 'Display P3',
	rec2020: 'Rec.2020',
	adobeRgb: 'Adobe RGB',
	custom: i18n.ts._Preview.GamutCompressionCustom,
}));
const modeLabel = computed(() => labels.value[previewGamutCompression.value.mode]);
const customPercentage = computed(() => Math.round(previewGamutCompression.value.customAmount * 100));
const active = computed(() => previewGamutCompression.value.mode !== 'none'
	&& (previewGamutCompression.value.mode !== 'custom' || previewGamutCompression.value.customAmount > 0));

function showMenu(event: MouseEvent) {
	ui.popupMenu([
		{ type: 'label', text: i18n.ts._Preview.GamutCompression },
		...modes.map(mode => ({
			id: `preview-gamut-${mode}`,
			text: labels.value[mode],
			active: previewGamutCompression.value.mode === mode,
			action: () => {
				// プリセットは色相・明度ごとに倍率が異なるため、カスタム量へ換算しない。
				previewGamutCompression.value = { ...previewGamutCompression.value, mode };
			},
		})),
	], event.currentTarget ?? event.target);
}

function onAmountInput(event: Event) {
	const input = event.target as HTMLInputElement;
	if (!Number.isFinite(input.valueAsNumber)) return;
	const percentage = Math.round(Math.max(0, Math.min(100, input.valueAsNumber)));
	input.value = String(percentage);
	previewGamutCompression.value = { ...previewGamutCompression.value, customAmount: percentage / 100 };
}

function onAmountBlur(event: FocusEvent) {
	// 空欄や未完成の数値は保持値へ戻し、表示と適用中の圧縮量を一致させる。
	(event.target as HTMLInputElement).value = String(customPercentage.value);
}
</script>

<style module lang="scss">
.root {
	display: flex;
	align-items: center;
	height: 100%;
}

.mode {
	height: 100%;
	padding: 0 8px;
	white-space: nowrap;
}

.amount {
	display: flex;
	align-items: center;
	gap: 2px;
	padding-right: 8px;
	font-variant-numeric: tabular-nums;
}

.input {
	width: 4em;
	padding: 1px 2px;
	border: solid 1px #fff3;
	border-radius: 3px;
	background: #0004;
	color: inherit;
	font: inherit;
	text-align: right;
}
</style>
