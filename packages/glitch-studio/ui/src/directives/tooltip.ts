// TODO: useTooltip関数使うようにしたい
// ただディレクティブ内でonUnmountedなどのcomposition api使えるのか不明

import { defineAsyncComponent, ref } from 'vue';
import type { Directive } from 'vue';
import { isTouchUsing } from '@/utility/touch.ts';
import { popup, alert } from '@/ui.ts';

const start = isTouchUsing ? 'touchstart' : 'mouseenter';
const end = isTouchUsing ? 'touchend' : 'mouseleave';

type TooltipDirectiveState = {
	text: string | null | undefined;
	_close: null | (() => void);
	show: () => void;
	close: () => void;

	abortController: AbortController;
	showTimer: number | null;
	hideTimer: number | null;
};

const states = new WeakMap<HTMLElement, TooltipDirectiveState>();

type TooltipDirectiveModifiers = 'left' | 'right' | 'top' | 'bottom' | 'noDelay';
type TooltipDirectiveArg = 'dialog';

export const tooltipDirective = {
	mounted(el, binding) {
		const delay = binding.modifiers.noDelay ? 0 : 100;

		const state = {
			text: binding.value,
			_close: null,
			abortController: new AbortController(),
			showTimer: null,
			hideTimer: null,
		} as TooltipDirectiveState;

		state.close = () => {
			if (state._close) {
				state._close();
				state._close = null;
			}
		};

		if (binding.arg === 'dialog') {
			el.addEventListener('click', (ev) => {
				const text = state.text ?? undefined;
				if (text == null) return;
				ev.preventDefault();
				ev.stopPropagation();
				alert({
					type: 'info',
					text,
				});
				return false;
			}, { signal: state.abortController.signal });
		}

		state.show = () => {
			if (!window.document.body.contains(el)) return;
			if (state._close) return;
			if (state.text == null) return;

			const showing = ref(true);
			const { dispose } = popup(defineAsyncComponent(() => import('@/components/common/GsTooltip.vue')), {
				showing,
				text: state.text,
				direction: binding.modifiers.left ? 'left' : binding.modifiers.right ? 'right' : binding.modifiers.top ? 'top' : binding.modifiers.bottom ? 'bottom' : 'top',
				anchorElement: el,
			}, {
				closed: () => dispose(),
			});

			state._close = () => {
				showing.value = false;
			};
		};

		el.addEventListener('selectstart', (ev) => {
			ev.preventDefault();
		}, { signal: state.abortController.signal });

		el.addEventListener(start, () => {
			if (state.showTimer) window.clearTimeout(state.showTimer);
			if (state.hideTimer) window.clearTimeout(state.hideTimer);
			if (delay === 0) {
				state.show();
			} else {
				state.showTimer = window.setTimeout(state.show, delay);
			}
		}, { passive: true, signal: state.abortController.signal });

		el.addEventListener(end, () => {
			if (state.showTimer) window.clearTimeout(state.showTimer);
			if (state.hideTimer) window.clearTimeout(state.hideTimer);
			if (delay === 0) {
				state.close();
			} else {
				state.hideTimer = window.setTimeout(state.close, delay);
			}
		}, { passive: true, signal: state.abortController.signal });

		el.addEventListener('click', () => {
			if (state.showTimer) window.clearTimeout(state.showTimer);
			state.close();
		}, { passive: true, signal: state.abortController.signal });

		states.set(el, state);
	},

	updated(el, binding) {
		const state = states.get(el);
		if (!state) return;
		state.text = binding.value;
	},

	beforeUnmount(el) {
		const state = states.get(el);
		if (!state) return;

		if (state.showTimer) window.clearTimeout(state.showTimer);
		if (state.hideTimer) window.clearTimeout(state.hideTimer);

		state.close();
		state.abortController.abort();

		states.delete(el);
	},
} as Directive<HTMLElement, string | null | undefined, TooltipDirectiveModifiers, TooltipDirectiveArg>;
