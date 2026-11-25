<template>
<GsWindow
	ref="windowEl"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header><i class="ti ti-ease-in-out-control-points"></i> {{ i18n.ts._FunctionCurve.Title }}: {{ title ?? props.functionCurve.nameForReference ?? i18n.ts._FunctionCurve.InlineFunctionCurve }}</template>

	<div :class="$style.root">
		<GsFunctionCurveTypeEditor :curve="functionCurve" @change="curve => emit('change', curve, null)"/>
		<GsFunctionCurvePointsEditor
			v-if="functionCurve.type === 'bezier'"
			:class="$style.editor"
			:key="String(functionCurve.isXNormalized) + String(functionCurve.isYNormalized)"
			:points="functionCurve.points"
			:isXNormalized="functionCurve.isXNormalized"
			:isYNormalized="functionCurve.isYNormalized"
			@change="updatePoints"
		/>
		<GsFixedFunctionCurvePreview v-else :curve="functionCurve"/>
	</div>
</GsWindow>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { useTemplateRef } from 'vue';
import GsWindow from './common/GsWindow.vue';
import GsFunctionCurvePointsEditor from './GsFunctionCurvePointsEditor.vue';
import GsFunctionCurveTypeEditor from './GsFunctionCurveTypeEditor.vue';
import GsFixedFunctionCurvePreview from './GsFixedFunctionCurvePreview.vue';
import type { BezierAnchorPoint, FunctionCurve } from '@gs/shared/function-curve/function-curve.ts';

const props = defineProps<{
	functionCurve: FunctionCurve & { nameForReference?: string };
	title?: string;
}>();

const emit = defineEmits<{
	(ev: 'change', curve: FunctionCurve, mergeKey: string | null): void,
	(ev: 'closed'): void
}>();

const windowEl = useTemplateRef('windowEl');

function updatePoints(points: BezierAnchorPoint[], mergeKey: string | null) {
	const curve = props.functionCurve;
	if (curve.type === 'bezier') emit('change', { ...curve, points }, mergeKey);
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 12px;
	height: 100%;
	padding: 8px;
	box-sizing: border-box;
}
.editor {
	flex: 1;
	min-height: 200px;
}
</style>
