<template>
<GsWindow
	ref="windowEl"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header><i class="ti ti-ease-in-out-control-points"></i> {{ i18n.ts._FunctionCurve.Title }}: {{ title ?? props.functionCurve.nameForReference ?? i18n.ts._FunctionCurve.InlineFunctionCurve }}</template>

	<div style="height: 100%;">
		<GsFunctionCurvePointsEditor
			:key="String(functionCurve.isXNormalized) + String(functionCurve.isYNormalized)"
			:points="functionCurve.points"
			:isXNormalized="functionCurve.isXNormalized"
			:isYNormalized="functionCurve.isYNormalized"
			@change="(points, mergeKey) => emit('change', points, mergeKey)"
		/>
	</div>
</GsWindow>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { useTemplateRef } from 'vue';
import GsWindow from './common/GsWindow.vue';
import GsFunctionCurvePointsEditor from './GsFunctionCurvePointsEditor.vue';
import type { FunctionCurve } from '@gs/shared/function-curve/function-curve.ts';

const props = defineProps<{
	functionCurve: FunctionCurve & { nameForReference?: string };
	title?: string;
}>();

const emit = defineEmits<{
	(ev: 'change', points: FunctionCurve['points'], mergeKey: string | null): void,
	(ev: 'done'): void,
	(ev: 'closed'): void
}>();

const windowEl = useTemplateRef('windowEl');
</script>

<style lang="scss" module>
</style>
