import type { Directive } from 'vue';
import { makeHotkey } from '@/utility/hotkey.ts';
import type { Keymap } from '@/utility/hotkey.ts';

const abortControllers = new WeakMap<HTMLElement, AbortController>();

export const hotkeyDirective = {
	mounted(el, binding) {
		const isGlobal = (binding.modifiers.global === true);
		const keyHandler = makeHotkey(binding.value);
		const abortController = new AbortController();

		if (isGlobal) {
			window.document.addEventListener('keydown', keyHandler, { passive: false, signal: abortController.signal });
		} else {
			el.addEventListener('keydown', keyHandler, { passive: false, signal: abortController.signal });
		}

		abortControllers.set(el, abortController);
	},

	beforeUnmount(el) {
		const abortController = abortControllers.get(el);
		if (abortController) {
			abortController.abort();
			abortControllers.delete(el);
		}
	},
} as Directive<HTMLElement, Keymap>;
