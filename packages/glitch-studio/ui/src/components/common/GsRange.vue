<template>
<div class="timctyfi" :class="{ disabled, easing }">
	<div class="label">
		<slot name="label"></slot>
	</div>
	<div class="body" :class="{ 'disabled': disabled }">
		<slot name="prefix"></slot>
		<div ref="containerEl" class="container">
			<div class="track">
				<div class="highlight right" :style="{ width: rightTrackWidth, left: rightTrackPosition }">
					<div class="shine right"></div>
				</div>
				<div class="highlight left" :style="{ width: leftTrackWidth, left: leftTrackPosition }">
					<div class="shine left"></div>
				</div>
			</div>
			<div v-if="steps && showTicks" class="ticks">
				<div v-for="i in (steps + 1)" class="tick" :style="{ left: (((i - 1) / steps) * 100) + '%' }"></div>
			</div>
			<div
				ref="thumbEl"
				class="thumb"
				:class="{ dragging: tooltipForDragShowing }"
				:style="{ left: thumbPosition + 'px' }"
				@mouseenter.passive="onMouseenter"
				@pointerdown="onPointerdown"
			>
				<div class="thumbInner"></div>
			</div>
		</div>
		<slot name="suffix"></slot>
	</div>
	<div class="caption">
		<slot name="caption"></slot>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { isTouchUsing } from '@/utility/touch.ts';
import * as ui from '@/ui.ts';
import GsTooltip from '@/components/common/GsTooltip.vue';

const props = withDefaults(defineProps<{
	modelValue: number;
	disabled?: boolean;
	min: number;
	max: number;
	step?: number;
	logarithmic?: boolean;
	textConverter?: (value: number) => string,
	showTicks?: boolean;
	easing?: boolean;
	continuousUpdate?: boolean;
}>(), {
	step: 1,
	easing: false,
});

const emit = defineEmits<{
	(ev: 'update:modelValue', value: number): void;
	(ev: 'beginChanging'): void;
	(ev: 'changeFinished'): void;
	(ev: 'dragEnded', value: number): void;
	(ev: 'thumbDoubleClicked'): void;
}>();

const containerEl = useTemplateRef('containerEl');
const thumbEl = useTemplateRef('thumbEl');

const useLogarithmic = computed(() => props.logarithmic && props.min > 0 && props.max > props.min);

function formatValue(value: number): string {
	if (props.textConverter) return props.textConverter(value);
	// 小さなSizeが0と表示されないよう、対数操作では有効桁数で表示する。
	return useLogarithmic.value ? Number(value.toPrecision(5)).toString() : (Math.round(value * 1000) / 1000).toString();
}

const maxRatio = computed(() => Math.abs(props.max) / (props.max + Math.abs(Math.min(0, props.min))));
const minRatio = computed(() => Math.abs(Math.min(0, props.min)) / (props.max + Math.abs(Math.min(0, props.min))));

const rightTrackWidth = computed(() => {
	return Math.max(0, (steppedRawValue.value - minRatio.value) * 100) + '%';
});
const leftTrackWidth = computed(() => {
	return Math.max(0, (minRatio.value - steppedRawValue.value) * 100) + '%';
});
const rightTrackPosition = computed(() => {
	return (Math.abs(Math.min(0, props.min)) / (props.max + Math.abs(Math.min(0, props.min)))) * 100 + '%';
});
const leftTrackPosition = computed(() => {
	return (Math.min(minRatio.value, steppedRawValue.value) * 100) + '%';
});

const calcRawValue = (value: number) => {
	if (useLogarithmic.value) {
		const clamped = Math.min(props.max, Math.max(props.min, value));
		return Math.log(clamped / props.min) / Math.log(props.max / props.min);
	}
	return (value - props.min) / (props.max - props.min);
};

const rawValue = ref(calcRawValue(props.modelValue));
const steppedRawValue = computed(() => {
	// 固定の値刻みで丸めると小さい値を調整できなくなるため、対数操作は連続値を使う。
	if (useLogarithmic.value) return rawValue.value;
	if (props.step) {
		const step = props.step / (props.max - props.min);
		return (step * Math.round(rawValue.value / step));
	} else {
		return rawValue.value;
	}
});
const finalValue = computed(() => {
	if (useLogarithmic.value) return props.min * (props.max / props.min) ** steppedRawValue.value;
	if (Number.isInteger(props.step)) {
		return Math.round((steppedRawValue.value * (props.max - props.min)) + props.min);
	} else {
		return (steppedRawValue.value * (props.max - props.min)) + props.min;
	}
});

const getThumbWidth = () => {
	if (thumbEl.value == null) return 0;
	return thumbEl.value!.offsetWidth;
};
const thumbPosition = ref(0);
const calcThumbPosition = () => {
	if (containerEl.value == null) {
		thumbPosition.value = 0;
	} else {
		thumbPosition.value = (containerEl.value.offsetWidth - getThumbWidth()) * steppedRawValue.value;
	}
};
watch([steppedRawValue, containerEl], calcThumbPosition);
watch(() => [props.modelValue, props.min, props.max, props.logarithmic] as const, ([newVal]) => {
	const newRawValue = calcRawValue(newVal);
	if (rawValue.value === newRawValue) return;
	rawValue.value = newRawValue;
});

let ro: ResizeObserver | undefined;

onMounted(() => {
	ro = new ResizeObserver((entries, observer) => {
		calcThumbPosition();
	});
	if (containerEl.value) ro.observe(containerEl.value);
});

onUnmounted(() => {
	if (ro) ro.disconnect();
});

const steps = computed(() => {
	if (useLogarithmic.value) return 0;
	if (props.step) {
		return (props.max - props.min) / props.step;
	} else {
		return 0;
	}
});

const tooltipForDragShowing = ref(false);
const tooltipForHoverShowing = ref(false);
let finishDrag: (() => void) | null = null;

onBeforeUnmount(() => {
	finishDrag?.();
	// 何らかの問題で表示されっぱなしでもコンポーネントを離れたら消えるように
	tooltipForDragShowing.value = false;
	tooltipForHoverShowing.value = false;
});

function onMouseenter() {
	if (isTouchUsing) return;

	tooltipForHoverShowing.value = true;

	const { dispose } = ui.popup(GsTooltip, {
		showing: computed(() => tooltipForHoverShowing.value && !tooltipForDragShowing.value),
		text: computed(() => {
			return formatValue(finalValue.value);
		}),
		anchorElement: thumbEl.value ?? undefined,
	}, {
		closed: () => dispose(),
	});

	thumbEl.value!.addEventListener('mouseleave', () => {
		tooltipForHoverShowing.value = false;
	}, { once: true, passive: true });
}

let lastClickTime: number | null = null;

function onPointerdown(ev: PointerEvent) {
	if (props.disabled) return; // Prevent interaction if disabled
	if (finishDrag != null || ev.button !== 0 || !ev.isPrimary) return;
	const thumb = thumbEl.value;
	if (!thumb) return;
	const pointerId = ev.pointerId;
	const ownerWindow = thumb.ownerDocument.defaultView;

	ev.preventDefault();
	// DOMを別ウィンドウへ移しても、つまみ自身でドラッグを追跡できるようにする。
	thumb.setPointerCapture(pointerId);
	emit('beginChanging');

	tooltipForDragShowing.value = true;

	const { dispose } = ui.popup(GsTooltip, {
		showing: tooltipForDragShowing,
		text: computed(() => {
			return formatValue(finalValue.value);
		}),
		anchorElement: thumbEl.value ?? undefined,
	}, {
		closed: () => dispose(),
	});

	const thumbWidth = getThumbWidth();

	const onDrag = (ev: PointerEvent) => {
		if (ev.pointerId !== pointerId) return;
		ev.preventDefault();
		let beforeValue = finalValue.value;
		const containerRect = containerEl.value!.getBoundingClientRect();
		const pointerPositionOnContainer = ev.clientX - (containerRect.left + (thumbWidth / 2));
		rawValue.value = Math.min(1, Math.max(0, pointerPositionOnContainer / (containerEl.value!.offsetWidth - thumbWidth)));

		if (props.continuousUpdate && beforeValue !== finalValue.value) {
			emit('update:modelValue', finalValue.value);
		}
	};

	let beforeValue = finalValue.value;

	const onPointerEnd = (ev: PointerEvent) => {
		if (ev.pointerId !== pointerId) return;
		endDrag();
	};

	const endDrag = () => {
		if (finishDrag == null) return;
		finishDrag = null;
		tooltipForDragShowing.value = false;
		thumb.removeEventListener('pointermove', onDrag);
		thumb.removeEventListener('pointerup', onPointerEnd);
		thumb.removeEventListener('pointercancel', onPointerEnd);
		thumb.removeEventListener('lostpointercapture', onPointerEnd);
		ownerWindow?.removeEventListener('blur', endDrag);
		if (thumb.hasPointerCapture(pointerId)) thumb.releasePointerCapture(pointerId);

		// 値が変わってたら通知
		if (beforeValue !== finalValue.value) {
			if (!props.continuousUpdate) emit('update:modelValue', finalValue.value);
			emit('dragEnded', finalValue.value);
		}
		emit('changeFinished');
	};

	finishDrag = endDrag;
	thumb.addEventListener('pointermove', onDrag);
	thumb.addEventListener('pointerup', onPointerEnd);
	thumb.addEventListener('pointercancel', onPointerEnd);
	thumb.addEventListener('lostpointercapture', onPointerEnd);
	ownerWindow?.addEventListener('blur', endDrag, { once: true });

	if (lastClickTime == null) {
		lastClickTime = Date.now();
		return;
	} else {
		const now = Date.now();
		if (now - lastClickTime < 300) { // 300ms以内のクリックはダブルクリックとみなす
			lastClickTime = null;
			emit('thumbDoubleClicked');
			return;
		} else {
			lastClickTime = now;
		}
	}
}
</script>

<style lang="scss" scoped>
@use "sass:math";

.timctyfi {
	position: relative;

	> .label {
		font-size: 0.85em;
		padding: 0 0 8px 0;
		user-select: none;

		&:empty {
			display: none;
		}
	}

	> .caption {
		font-size: 0.85em;
		padding: 8px 0 0 0;
		color: color(from var(--THEME-fg) srgb r g b / 0.75);

		&:empty {
			display: none;
		}
	}

	$thumbHeight: 20px;
	$thumbWidth: 20px;
	$thumbInnerHeight: 13px;
	$thumbInnerWidth: 13px;

	> .body {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0px 4px;

		&.disabled {
			pointer-events: none;
			opacity: 0.6;
		}

		> .container {
			flex: 1;
			position: relative;
			height: $thumbHeight;

			> .track {
				position: absolute;
				top: 0;
				bottom: 0;
				left: 0;
				right: 0;
				margin: auto;
				width: calc(100% - #{$thumbWidth});
				height: 3px;
				background: rgba(0, 0, 0, 0.3);
				border-radius: 999px;
				overflow: clip;

				> .highlight {
					position: absolute;
					top: 0;
					height: 100%;
					background: color(from var(--THEME-accent) srgb r g b / 0.5);
					overflow: clip;

					> .shine {
						position: absolute;
						top: 0;
						width: 64px;
						height: 100%;
					}
				}

				> .highlight.right {
					> .shine.right {
						right: calc(#{$thumbInnerWidth} / 2);
						//background: linear-gradient(-90deg, var(--THEME-accent2), color(from var(--THEME-accent) srgb r g b / 0));
						background: color(from var(--THEME-accent) srgb r g b / 0);
					}
				}

				> .highlight.left {
					> .shine.left {
						left: calc(#{$thumbInnerWidth} / 2);
						//background: linear-gradient(90deg, var(--THEME-accent2), color(from var(--THEME-accent) srgb r g b / 0));
						background: color(from var(--THEME-accent) srgb r g b / 0);
					}
				}
			}

			> .ticks {
				$tickWidth: 3px;

				position: absolute;
				top: 0;
				bottom: 0;
				left: 0;
				right: 0;
				margin: auto;
				width: calc(100% - #{$thumbWidth});

				> .tick {
					position: absolute;
					bottom: 0;
					width: $tickWidth;
					height: 3px;
					margin-left: - math.div($tickWidth, 2);
					background: var(--THEME-divider);
					border-radius: 999px;
				}
			}

			> .thumb {
				position: absolute;
				width: $thumbWidth;
				height: $thumbHeight;
				cursor: grab;
				touch-action: none;
				user-select: none;

				&.dragging {
					cursor: grabbing;
				}

				&:hover {
					> .thumbInner {
						background: hsl(from var(--THEME-accent) h s calc(l + 10));
					}
				}

				> .thumbInner {
					position: absolute;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					margin: auto;
					width: $thumbInnerWidth;
					height: $thumbInnerHeight;
					background: var(--THEME-accent);
					border-radius: 999px;
					pointer-events: none;
				}
			}
		}
	}

	&.easing {
		> .body {
			> .container {
				> .track {
					> .highlight {
						transition: width 0.2s cubic-bezier(0, 0, 0, 1);
					}
				}

				> .thumb {
					transition: left 0.2s cubic-bezier(0, 0, 0, 1);
				}
			}
		}
	}
}
</style>
