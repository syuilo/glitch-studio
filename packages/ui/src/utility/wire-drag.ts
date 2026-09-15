import { shallowRef } from 'vue';
import type { NodeOutputReference } from '@glitch/shared/types.ts';

export const wireDrag = shallowRef<{
	source: HTMLElement;
	clientX: number;
	clientY: number;
} | null>(null);

const inputPorts = new WeakMap<HTMLElement, (connection: NodeOutputReference) => void>();
let cancelCurrentDrag: (() => void) | undefined;

export function registerWireInput(el: HTMLElement, connect: (connection: NodeOutputReference) => void) {
	inputPorts.set(el, connect);
	return () => {
		if (inputPorts.get(el) === connect) inputPorts.delete(el);
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

	function move(event: PointerEvent) {
		if (event.pointerId !== pointerId) return;
		wireDrag.value = { source, clientX: event.clientX, clientY: event.clientY };
	}

	function cancel() {
		if (!active) return;
		active = false;
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
		// capture中のevent.targetは出力ポートなので、実際のドロップ位置を調べる。
		let target = doc.elementFromPoint(event.clientX, event.clientY);
		let connect: ((connection: NodeOutputReference) => void) | undefined;
		while (target instanceof HTMLElement) {
			if (target.closest('[inert]')) break;
			connect = inputPorts.get(target);
			if (connect) break;
			target = target.parentElement;
		}
		cancel();
		connect?.(connection);
	}

	source.setPointerCapture(pointerId);
	cancelCurrentDrag = cancel;
	move(event);
	view.addEventListener('pointermove', move);
	view.addEventListener('pointerup', drop);
	view.addEventListener('pointercancel', onCancel);
	view.addEventListener('blur', cancel);
	view.addEventListener('keydown', onKeyDown);
	source.addEventListener('lostpointercapture', onCancel);
	return cancel;
}
