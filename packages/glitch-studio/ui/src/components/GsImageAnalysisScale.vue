<template>
<label :class="$style.root">
	<select v-model="analysisValueScale" data-test-image-analysis-scale>
		<option value="srgb">sRGB · 0–1</option>
		<option value="linear">Linear · −1–4</option>
		<option value="ev">EV · −10–+10 · 0 EV = 0.18</option>
	</select>
</label>
</template>

<script setup lang="ts">
import { appContext } from '@/app.ts';

const { analysisValueScale } = appContext;
</script>

<style module lang="scss">
.root {
	display: block;
	padding: 4px;
	font-size: 11px;
	select {
		color: inherit;
		background: var(--THEME-panel);
		border: 1px solid var(--THEME-divider);
		border-radius: 4px;
	}
}
</style>
