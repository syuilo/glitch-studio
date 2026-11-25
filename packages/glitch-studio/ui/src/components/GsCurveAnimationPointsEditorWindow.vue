<template>
<GsWindow
	ref="windowEl"
	:canResize="true"
	@close="windowEl?.close()"
	@closed="emit('closed')"
>
	<template #header><i class="ti ti-ease-in-out-control-points"></i> {{ i18n.ts._CurveAnimation.Title }}: {{ title ?? props.curveAnimation.nameForReference ?? i18n.ts._CurveAnimation.InlineCurveAnimation }}</template>

	<div style="height: 100%;">
		<GsCurveAnimationPointsEditor :key="String(props.curveAnimation.isNormalized)" :points="props.curveAnimation.points" :isNormalized="props.curveAnimation.isNormalized" @change="(points, mergeKey) => emit('change', points, mergeKey)"/>
	</div>
</GsWindow>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { useTemplateRef } from 'vue';
import GsWindow from './common/GsWindow.vue';
import GsCurveAnimationPointsEditor from './GsCurveAnimationPointsEditor.vue';
import type { CurveAnimation } from '@gs/shared/curve-animation/curve-animation.ts';

const props = defineProps<{
	curveAnimation: Pick<CurveAnimation, 'points' | 'isNormalized'> & { nameForReference?: string };
	title?: string;
}>();

const emit = defineEmits<{
	(ev: 'change', points: CurveAnimation['points'], mergeKey: string | null): void,
	(ev: 'done'): void,
	(ev: 'closed'): void
}>();

const windowEl = useTemplateRef('windowEl');
</script>

<style lang="scss" module>
</style>
