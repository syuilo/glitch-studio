import type { App, Directive } from 'vue';

import { tooltipDirective } from './tooltip.ts';
import { hotkeyDirective } from './hotkey.ts';

export default function(app: App) {
	for (const [key, value] of Object.entries(directives)) {
		app.directive(key, value);
	}
}

export const directives = {
	'tooltip': tooltipDirective,
	'hotkey': hotkeyDirective,
} as Record<string, Directive>;

declare module 'vue' {
	export interface GlobalDirectives {
		vTooltip: typeof tooltipDirective;
		vHotkey: typeof hotkeyDirective;
	}
}
