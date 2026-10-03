<template>
<div ref="rootEl" :class="$style.root" class="_popup _shadow" :style="{ zIndex }" @contextmenu.prevent="() => {}">
	<ol v-if="type === 'variable' && vars.length > 0" ref="suggests" :class="$style.list">
		<li v-for="variable in vars" tabindex="-1" :class="$style.item" @click="complete(type, variable)" @keydown="onKeydown">
			<span>{{ variable }}</span>
		</li>
	</ol>
</div>
</template>

<script lang="ts">
import { markRaw, ref, useTemplateRef, computed, onUpdated, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { elementContains } from '@/utility/element-contains.ts';
import * as ui from '@/ui.ts';
import { i18n } from '@/i18n.ts';

export type CompleteInfo = {
	variable: {
		payload: string;
		query: string;
	},
};
</script>

<script lang="ts" setup generic="T extends keyof CompleteInfo">
type PropsType<T extends keyof CompleteInfo> = {
	type: T;
	q: CompleteInfo[T]['query'];
	// なぜかわからないけど HTMLTextAreaElement | HTMLInputElement だと addEventListener/removeEventListenerがエラー
	textarea: (HTMLTextAreaElement | HTMLInputElement) & HTMLElement;
	close: () => void;
	x: number;
	y: number;
};
//const props = defineProps<PropsType<keyof CompleteInfo>>();
// ↑と同じだけど↓にしないとdiscriminated unionにならない。
// https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes-func.html#discriminated-unions
const props = defineProps<PropsType<'variable'>>();

const emit = defineEmits<{
	<T extends keyof CompleteInfo>(event: 'done', value: { type: T; value: CompleteInfo[T]['payload'] }): void;
	(event: 'closed'): void;
}>();

const suggests = ref<Element>();
const rootEl = useTemplateRef('rootEl');

const items = ref<Element[] | HTMLCollection>([]);
const vars = ref<string[]>([]);
const select = ref(-1);
const zIndex = ui.claimZIndex('high');

const VARS = ['TIME'];

function complete<T extends keyof CompleteInfo>(type: T, value: CompleteInfo[T]['payload']) {
	emit('done', { type, value });
	emit('closed');
}

function setPosition() {
	if (!rootEl.value) return;
	if (props.x + rootEl.value.offsetWidth > window.innerWidth) {
		rootEl.value.style.left = (window.innerWidth - rootEl.value.offsetWidth) + 'px';
	} else {
		rootEl.value.style.left = `${props.x}px`;
	}
	if (props.y + rootEl.value.offsetHeight > window.innerHeight) {
		rootEl.value.style.top = (props.y - rootEl.value.offsetHeight) + 'px';
		rootEl.value.style.marginTop = '0';
	} else {
		rootEl.value.style.top = props.y + 'px';
		rootEl.value.style.marginTop = 'calc(1em + 8px)';
	}
}

function exec() {
	select.value = -1;
	if (suggests.value) {
		for (const el of Array.from(items.value)) {
			el.removeAttribute('data-selected');
		}
	}
	if (props.type === 'variable') {
		if (!props.q || props.q === '') {
			vars.value = VARS;
			return;
		}

		vars.value = VARS.filter(tag => tag.startsWith(props.q ?? ''));
	}
}

function onMousedown(event: MouseEvent) {
	if (!elementContains(rootEl.value, event.target as Element) && (rootEl.value !== event.target)) props.close();
}

function onKeydown(event: KeyboardEvent) {
	const cancel = () => {
		event.preventDefault();
		event.stopPropagation();
	};

	switch (event.key) {
		case 'Enter':
			if (select.value !== -1) {
				cancel();
				(items.value[select.value] as any).click();
			} else {
				props.close();
			}
			break;

		case 'Escape':
			cancel();
			props.close();
			break;

		case 'ArrowUp':
			if (select.value !== -1) {
				cancel();
				selectPrev();
			} else {
				props.close();
			}
			break;

		case 'ArrowDown':
			cancel();
			selectNext();
			break;

		case 'Tab':
			if (event.shiftKey) {
				if (select.value !== -1) {
					cancel();
					selectPrev();
				} else {
					props.close();
				}
			} else {
				cancel();
				selectNext();
			}
			break;

		default:
			event.stopPropagation();
			props.textarea.focus();
	}
}

function selectNext() {
	if (++select.value >= items.value.length) select.value = 0;
	if (items.value.length === 0) select.value = -1;
	applySelect();
}

function selectPrev() {
	if (--select.value < 0) select.value = items.value.length - 1;
	applySelect();
}

function applySelect() {
	for (const el of Array.from(items.value)) {
		el.removeAttribute('data-selected');
	}

	if (select.value !== -1) {
		items.value[select.value].setAttribute('data-selected', 'true');
		(items.value[select.value] as any).focus();
	}
}

onUpdated(() => {
	setPosition();
	items.value = suggests.value?.children ?? [];
});

onMounted(() => {
	setPosition();

	props.textarea.addEventListener('keydown', onKeydown);

	window.document.body.addEventListener('mousedown', onMousedown);

	nextTick(() => {
		exec();

		watch(() => props.q, () => {
			nextTick(() => {
				exec();
			});
		});
	});
});

onBeforeUnmount(() => {
	props.textarea.removeEventListener('keydown', onKeydown);

	window.document.body.removeEventListener('mousedown', onMousedown);
});
</script>

<style lang="scss" module>
.root {
	position: fixed;
	max-width: 100%;
	margin-top: calc(1em + 8px);
	overflow: clip;
	transition: top 0.1s ease, left 0.1s ease;
}

.list {
	display: block;
	margin: 0;
	padding: 4px 0;
	max-height: 190px;
	max-width: 500px;
	overflow: auto;
	list-style: none;
}

.item {
	display: flex;
	align-items: center;
	padding: 4px 12px;
	white-space: nowrap;
	overflow: clip;
	font-size: 0.9em;
	cursor: default;
	user-select: none;
	overflow: hidden;
	text-overflow: ellipsis;

	&:hover {
		background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
	}

	&[data-selected='true'] {
		background: var(--MI_THEME-accent);
		color: #fff !important;
	}

	&:active {
		background: hsl(from var(--MI_THEME-accent) h s calc(l - 10));
		color: #fff !important;
	}
}

.avatar {
	min-width: 28px;
	min-height: 28px;
	max-width: 28px;
	max-height: 28px;
	margin: 0 8px 0 0;
	border-radius: 100%;
	object-fit: cover;
}

.userName {
	margin: 0 8px 0 0;
}

.emoji {
	flex-shrink: 0 !important;
	display: flex !important;
	margin: 0 4px 0 0 !important;
	height: 24px !important;
	width: 24px !important;
	justify-content: center !important;
	align-items: center !important;
	font-size: 20px !important;
	pointer-events: none !important;
}

.emojiImg {
	height: 24px;
	width: 24px;
	object-fit: scale-down;
}

.emojiName {
	flex-shrink: 1;
}

.emojiAlias {
	flex-shrink: 9999999;
	margin: 0 0 0 8px;
}
</style>
