<template>
<Transition
	:name="transitionName"
	:enterActiveClass="normalizeClass({
		[$style.transition_modalDrawer_enterActive]: transitionName === 'modal-drawer',
		[$style.transition_modalPopup_enterActive]: transitionName === 'modal-popup',
		[$style.transition_modal_enterActive]: transitionName === 'modal',
		[$style.transition_send_enterActive]: transitionName === 'send',
	})"
	:leaveActiveClass="normalizeClass({
		[$style.transition_modalDrawer_leaveActive]: transitionName === 'modal-drawer',
		[$style.transition_modalPopup_leaveActive]: transitionName === 'modal-popup',
		[$style.transition_modal_leaveActive]: transitionName === 'modal',
		[$style.transition_send_leaveActive]: transitionName === 'send',
	})"
	:enterFromClass="normalizeClass({
		[$style.transition_modalDrawer_enterFrom]: transitionName === 'modal-drawer',
		[$style.transition_modalPopup_enterFrom]: transitionName === 'modal-popup',
		[$style.transition_modal_enterFrom]: transitionName === 'modal',
		[$style.transition_send_enterFrom]: transitionName === 'send',
	})"
	:leaveToClass="normalizeClass({
		[$style.transition_modalDrawer_leaveTo]: transitionName === 'modal-drawer',
		[$style.transition_modalPopup_leaveTo]: transitionName === 'modal-popup',
		[$style.transition_modal_leaveTo]: transitionName === 'modal',
		[$style.transition_send_leaveTo]: transitionName === 'send',
	})"
	:duration="transitionDuration" appear @afterLeave="onClosed" @enter="emit('opening')" @afterEnter="onOpened"
>
	<div
		v-show="manualShowing != null ? manualShowing : showing"
		ref="modalRootEl"
		v-hotkey.global="keymap"
		:class="[$style.root, { [$style.drawer]: type === 'drawer', [$style.dialog]: type === 'dialog', [$style.popup]: type === 'popup' }]"
		:style="{ zIndex, pointerEvents: (manualShowing != null ? manualShowing : showing) ? 'auto' : 'none', '--transformOrigin': transformOrigin }"
		@dragover="emit('dragover', $event)"
		@drop="emit('drop', $event)"
	>
		<div data-testid="bg" :data-test-is-transparent="isEnableBgTransparent" class="_modalBg" :class="[$style.bg, { [$style.bgTransparent]: isEnableBgTransparent }]" :style="{ zIndex }" @click="onBgClick" @mousedown="onBgClick" @contextmenu.prevent.stop="() => {}">
			<GsAnimBg v-if="animatedBg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"/>
		</div>
		<div ref="content" :class="[$style.content, { [$style.fixed]: fixed }]" :style="{ zIndex }" @click.self="onBgClick">
			<slot :max-height="maxHeight" :type="type"></slot>
		</div>
	</div>
</Transition>
</template>

<script lang="ts" setup>
import { nextTick, normalizeClass, onMounted, onBeforeUnmount, onUnmounted, provide, watch, ref, useTemplateRef, computed } from 'vue';
import GsAnimBg from './GsAnimBg.vue';
import type { Keymap } from '@/utility/hotkey.ts';
import * as ui from '@/ui.ts';
import { isTouchUsing } from '@/utility/touch.ts';
import { deviceKind } from '@/utility/device-kind.ts';
import { focusTrap } from '@/utility/focus-trap.ts';
import { focusParent } from '@/utility/focus.ts';
import { preferences } from '@/preferences.ts';

function getFixedContainer(el: Element | null): Element | null {
	if (el == null || el.tagName === 'BODY') return null;
	const position = window.getComputedStyle(el).getPropertyValue('position');
	if (position === 'fixed') {
		return el;
	} else {
		return getFixedContainer(el.parentElement);
	}
}

type ModalTypes = 'popup' | 'dialog' | 'drawer';

const props = withDefaults(defineProps<{
	manualShowing?: boolean | null;
	anchor?: { x: string; y: string; };
	anchorElement?: HTMLElement | null;
	preferType?: ModalTypes | 'auto';
	zPriority?: 'low' | 'middle' | 'high';
	noOverlap?: boolean;
	transparentBg?: boolean;
	animatedBg?: boolean;
	hasInteractionWithOtherFocusTrappedEls?: boolean;
	returnFocusTo?: HTMLElement | null;
}>(), {
	manualShowing: null,
	anchorElement: null,
	anchor: () => ({ x: 'center', y: 'bottom' }),
	preferType: 'auto',
	zPriority: 'low',
	noOverlap: true,
	transparentBg: false,
	animatedBg: false,
	hasInteractionWithOtherFocusTrappedEls: false,
	returnFocusTo: null,
});

const emit = defineEmits<{
	(ev: 'dragover', event: DragEvent): void;
	(ev: 'drop', event: DragEvent): void;
	(ev: 'opening'): void;
	(ev: 'opened'): void;
	(ev: 'click'): void;
	(ev: 'esc'): void;
	(ev: 'close'): void; // TODO: (refactor) closing に改名する
	(ev: 'closed'): void;
}>();

provide(ui.DI.inModal, true);

const maxHeight = ref<number>();
const fixed = ref(false);
const transformOrigin = ref('center');
const showing = ref(true);
const modalRootEl = useTemplateRef('modalRootEl');
const content = useTemplateRef('content');
const zIndex = ui.claimZIndex(props.zPriority);
const useSendAnime = ref(false);
const type = computed<ModalTypes>(() => {
	if (props.preferType === 'auto') {
		if ((preferences.s.menuStyle === 'drawer') || (preferences.s.menuStyle === 'auto' && isTouchUsing && deviceKind === 'smartphone')) {
			return 'drawer';
		} else {
			return props.anchorElement != null ? 'popup' : 'dialog';
		}
	} else {
		return props.preferType!;
	}
});
const isEnableBgTransparent = computed(() => props.transparentBg && (type.value === 'popup'));
const transitionName = computed((() =>
	preferences.s.animation
		? useSendAnime.value
			? 'send'
			: type.value === 'drawer'
				? 'modal-drawer'
				: type.value === 'popup'
					? 'modal-popup'
					: 'modal'
		: ''
));
const transitionDuration = computed((() =>
	transitionName.value === 'send'
		? 400
		: transitionName.value === 'modal-popup'
			? 100
			: transitionName.value === 'modal'
				? 200
				: transitionName.value === 'modal-drawer'
					? 200
					: 0
));

let releaseFocusTrap: (() => void) | null = null;
let contentClicking = false;

function releaseModalFocusTrap() {
	releaseFocusTrap?.();
	releaseFocusTrap = null;
}

function close(opts: { useSendAnimation?: boolean } = {}) {
	if (opts.useSendAnimation) {
		useSendAnime.value = true;
	}

	if (props.anchorElement) props.anchorElement.style.pointerEvents = 'auto';
	showing.value = false;
	emit('close');
}

function onBgClick() {
	if (contentClicking) return;
	emit('click');
}

if (type.value === 'drawer') {
	maxHeight.value = window.innerHeight / 1.5;
}

const keymap = {
	'esc': {
		allowRepeat: true,
		callback: () => emit('esc'),
	},
} as const satisfies Keymap;

const POPUP_VERTICAL_MARGIN = 16;

function align() {
	const popupContent = content.value;
	const anchorElement = props.anchorElement;
	if (type.value !== 'popup' || anchorElement == null || popupContent == null) return;

	const height = popupContent.offsetHeight;
	if (height === 0) return;

	const anchorRect = anchorElement.getBoundingClientRect();
	const width = popupContent.offsetWidth;
	const { clientWidth, clientHeight } = window.document.documentElement;
	const viewportTop = POPUP_VERTICAL_MARGIN;
	const viewportBottom = clientHeight - POPUP_VERTICAL_MARGIN;
	const upperSpace = anchorRect.top - viewportTop;
	const lowerSpace = viewportBottom - anchorRect.bottom;

	let left = 0;
	if (props.anchor.x === 'center') {
		left = anchorRect.left + (anchorRect.width - width) / 2;
	} else if (props.anchor.x === 'right') {
		left = anchorRect.right;
	}

	let top = viewportTop;
	if (props.anchor.y === 'center') {
		top = anchorRect.top - height / 2;
	} else if (props.anchor.y === 'bottom') {
		top = anchorRect.bottom;
	}

	if (props.noOverlap && props.anchor.x === 'center' && props.anchor.y === 'bottom') {
		// 下に収まらないときは、上に収まるかを先に確認する。両側とも狭い場合は
		// 広い側の高さをメニューへ渡し、その側でより多くの項目を表示できるようにする。
		const placeAbove = height > lowerSpace && upperSpace > lowerSpace;
		if (placeAbove) top = anchorRect.top - height;
		maxHeight.value = Math.max(1, placeAbove ? upperSpace : lowerSpace);
	} else {
		maxHeight.value = Math.max(1, viewportBottom - viewportTop);
	}

	// 高さを自身で制限するポップアップも、上下どちらにも収まらない場合は
	// アンカーとの重なりを許容して画面の端まで移動し、操作できる領域を確保する。
	left = Math.max(0, Math.min(left, clientWidth - width));
	top = Math.max(viewportTop, Math.min(top, viewportBottom - height));

	const transformOriginX = left >= anchorRect.right ? 'left' : left + width <= anchorRect.left ? 'right' : 'center';
	const transformOriginY = top >= anchorRect.bottom ? 'top' : top + height <= anchorRect.top ? 'bottom' : 'center';
	transformOrigin.value = `${transformOriginX} ${transformOriginY}`;

	// 配置の判定はビューポート座標で統一し、absoluteの場合だけ文書座標へ換算する。
	popupContent.style.left = (left + (fixed.value ? 0 : window.scrollX)) + 'px';
	popupContent.style.top = (top + (fixed.value ? 0 : window.scrollY)) + 'px';
}

const onOpened = () => {
	emit('opened');

	// contentの子要素にアクセスするためレンダリングの完了を待つ必要がある（nextTickが必要）
	nextTick(() => {
		// NOTE: Chromatic テストの際に undefined になる場合がある
		if (content.value == null) return;

		// モーダルコンテンツにマウスボタンが押され、コンテンツ外でマウスボタンが離されたときにモーダルバックグラウンドクリックと判定させないためにマウスイベントを監視しフラグ管理する
		const el = content.value.children[0];
		el.addEventListener('mousedown', ev => {
			contentClicking = true;
			window.addEventListener('mouseup', ev => {
				// click イベントより先に mouseup イベントが発生するかもしれないのでちょっと待つ
				window.setTimeout(() => {
					contentClicking = false;
				}, 100);
			}, { passive: true, once: true });
		}, { passive: true });
	});
};

const onClosed = () => {
	emit('closed');
};

const alignObserver = new ResizeObserver((entries, observer) => {
	align();
});

onMounted(() => {
	watch(type, (type, _, onCleanup) => {
		if (type !== 'popup') return;
		window.addEventListener('resize', align);
		onCleanup(() => window.removeEventListener('resize', align));
	}, { immediate: true });

	watch(() => props.anchorElement, async () => {
		if (props.anchorElement) {
			props.anchorElement.style.pointerEvents = 'none';
		}
		fixed.value = (type.value === 'drawer') || (getFixedContainer(props.anchorElement) != null);

		await nextTick();

		align();
	}, { immediate: true });

	watch([showing, () => props.manualShowing], ([showing, manualShowing]) => {
		if (manualShowing === true || (manualShowing == null && showing === true)) {
			if (modalRootEl.value != null) {
				const { release } = focusTrap(modalRootEl.value, {
					zIndex,
					hasInteractionWithOtherFocusTrappedEls: props.hasInteractionWithOtherFocusTrappedEls,
				});

				releaseFocusTrap = release;
				modalRootEl.value.focus();
			}
		} else {
			releaseModalFocusTrap();
			focusParent(props.returnFocusTo ?? props.anchorElement, true, false);
		}
	}, { immediate: true });

	nextTick(() => {
		alignObserver.observe(content.value!);
	});
});

// popupの直接破棄ではshowingが変化しない。親・兄弟のDOMが残る間にinertを解除する。
// 新しいモーダルへ移ったフォーカスを奪わないよう、破棄時にはフォーカスを移動しない。
onBeforeUnmount(releaseModalFocusTrap);

onUnmounted(() => {
	alignObserver.disconnect();
});

defineExpose({
	close,
	// 背景も含むモーダル全体へイベントを登録する際、Transitionの$elには依存しない。
	getRootElement: () => modalRootEl.value,
});
</script>

<style lang="scss" module>
.transition_send_enterActive,
.transition_send_leaveActive {
	> .bg {
		transition: opacity 0.3s !important;
	}

	> .content {
    transform: translateY(0px);
		transition: opacity 0.3s ease-in, transform 0.3s cubic-bezier(.5,-0.5,1,.5) !important;
	}
}
.transition_send_enterFrom,
.transition_send_leaveTo {
	> .bg {
		opacity: 0;
	}

	> .content {
		pointer-events: none;
		opacity: 0;
		transform: translateY(-300px);
	}
}

.transition_modal_enterActive,
.transition_modal_leaveActive {
	> .bg {
		transition: opacity 0.2s !important;
	}

	> .content {
		transform-origin: var(--transformOrigin);
		transition: opacity 0.2s, transform 0.2s !important;
	}
}
.transition_modal_enterFrom,
.transition_modal_leaveTo {
	> .bg {
		opacity: 0;
	}

	> .content {
		pointer-events: none;
		opacity: 0;
		transform-origin: var(--transformOrigin);
		transform: scale(0.9);
	}
}

.transition_modalPopup_enterActive,
.transition_modalPopup_leaveActive {
	> .bg {
		transition: opacity 0.1s !important;
	}

	> .content {
		transform-origin: var(--transformOrigin);
		transition: opacity 0.1s cubic-bezier(0, 0, 0.2, 1), transform 0.1s cubic-bezier(0, 0, 0.2, 1) !important;
	}
}
.transition_modalPopup_enterFrom,
.transition_modalPopup_leaveTo {
	> .bg {
		opacity: 0;
	}

	> .content {
		pointer-events: none;
		opacity: 0;
		transform-origin: var(--transformOrigin);
		transform: scale(0.9);
	}
}

.transition_modalDrawer_enterActive {
	> .bg {
		transition: opacity 0.2s !important;
	}

	> .content {
		transition: transform 0.2s cubic-bezier(0,.5,0,1) !important;
	}
}
.transition_modalDrawer_leaveActive {
	> .bg {
		transition: opacity 0.2s !important;
	}

	> .content {
		transition: transform 0.2s cubic-bezier(0,.5,0,1) !important;
	}
}
.transition_modalDrawer_enterFrom,
.transition_modalDrawer_leaveTo {
	> .bg {
		opacity: 0;
	}

	> .content {
		pointer-events: none;
		transform: translateY(100%);
	}
}

.root {
	&.dialog {
		> .content {
			position: fixed;
			top: 0;
			bottom: 0;
			left: 0;
			right: 0;
			margin: auto;
			padding: 32px;
			display: flex;
			overflow: auto;

			@media (max-width: 500px) {
				padding: 16px;
			}
		}
	}

	&.popup {
		> .content {
			position: absolute;

			&.fixed {
				position: fixed;
			}
		}
	}

	&.drawer {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		overflow: clip;

		> .content {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			margin: auto;
		}
	}
}

.bg {
	&.bgTransparent {
		background: transparent;
		-webkit-backdrop-filter: none;
		backdrop-filter: none;
	}
}
</style>
