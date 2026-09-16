import { shallowRef } from 'vue';
import type { NodeOutputReference } from '@glitch/shared/types.ts';

export const wireDrag = shallowRef<{
	source: HTMLElement;
	clientX: number;
	clientY: number;
} | null>(null);

type WireInput = {
	connect: (connection: NodeOutputReference) => void;
	canConnect: (connection: NodeOutputReference) => boolean;
};

const inputPorts = new WeakMap<HTMLElement, WireInput>();
let cancelCurrentDrag: (() => void) | undefined;
let highlightedInput: HTMLElement | null = null;

function highlightInput(el: HTMLElement | null) {
	if (highlightedInput === el) return;
	highlightedInput?.removeAttribute('data-wire-drop-target');
	highlightedInput = el;
	highlightedInput?.setAttribute('data-wire-drop-target', '');
}

export function registerWireInput(el: HTMLElement, connect: WireInput['connect'], canConnect: WireInput['canConnect']) {
	const input = { connect, canConnect };
	inputPorts.set(el, input);
	return () => {
		if (inputPorts.get(el) !== input) return;
		inputPorts.delete(el);
		if (highlightedInput === el) highlightInput(null);
	};
}

export function startWireDrag(event: PointerEvent, connection: NodeOutputReference) {
	if (event.button !== 0 || !event.isPrimary) return;
	if (!(event.currentTarget instanceof HTMLElement)) return;
	const source = event.currentTarget;
	event.preventDefault();
	event.stopPropagation();
	cancelCurrentDrag?.();
	const pointerId = event.pointerId;
	const doc = source.ownerDocument;
	const view = doc.defaultView!;
	let active = true;
	let highlightFrame = 0;

	function findInput(clientX: number, clientY: number) {
		// capture中のevent.targetは出力ポートなので、実際のポインター位置を調べる。
		let target = doc.elementFromPoint(clientX, clientY);
		while (target != null) {
			if (target.closest('[inert]')) return null;
			const input = target instanceof HTMLElement ? inputPorts.get(target) : undefined;
			if (input) return input.canConnect(connection) ? { el: target as HTMLElement, input } : null;
			target = target.parentElement;
		}
		return null;
	}

	function updateHighlight() {
		const drag = wireDrag.value;
		highlightInput(drag ? findInput(drag.clientX, drag.clientY)?.el ?? null : null);
		// ポインターが静止したままスクロールや行の更新が起きた場合も追従する。
		highlightFrame = view.requestAnimationFrame(updateHighlight);
	}

	function move(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		wireDrag.value = { source, clientX: event.clientX, clientY: event.clientY };
	}

	function cancel() {
		if (!active) return;
		active = false;
		view.cancelAnimationFrame(highlightFrame);
		highlightInput(null);
		view.removeEventListener('pointermove', move);
		view.removeEventListener('pointerup', drop);
		view.removeEventListener('pointercancel', onCancel);
		view.removeEventListener('blur', cancel);
		view.removeEventListener('keydown', onKeyDown);
		source.removeEventListener('lostpointercapture', onCancel);
		if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
		wireDrag.value = null;
		if (cancelCurrentDrag === cancel) cancelCurrentDrag = undefined;
	}

	function onCancel(event: PointerEvent) {
		if (event.pointerId === pointerId) cancel();
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') cancel();
	}

	function drop(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		const target = findInput(event.clientX, event.clientY);
		cancel();
		target?.input.connect(connection);
	}

	source.setPointerCapture(pointerId);
	cancelCurrentDrag = cancel;
	move(event);
	updateHighlight();
	view.addEventListener('pointermove', move);
	view.addEventListener('pointerup', drop);
	view.addEventListener('pointercancel', onCancel);
	view.addEventListener('blur', cancel);
	view.addEventListener('keydown', onKeyDown);
	source.addEventListener('lostpointercapture', onCancel);
	return cancel;
}
