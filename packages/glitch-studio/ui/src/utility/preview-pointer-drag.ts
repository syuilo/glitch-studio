/** 表示先のDocumentで追跡するため、PiP・別ウィンドウでも同じ操作を使える。 */
export function startPreviewPointerDrag(event: PointerEvent, handlers: { move(event: PointerEvent): void; end(cancelled: boolean): void }): () => void {
	const target = event.currentTarget as HTMLElement | SVGElement;
	const doc = target.ownerDocument;
	const view = doc.defaultView!;
	const pointerId = event.pointerId;
	let ended = false;
	const finish = (cancelled: boolean) => {
		if (ended) return;
		ended = true;
		doc.removeEventListener('pointermove', move);
		doc.removeEventListener('pointerup', up);
		doc.removeEventListener('pointercancel', cancelPointer);
		target.removeEventListener('lostpointercapture', cancel);
		doc.removeEventListener('keydown', keydown, true);
		view.removeEventListener('blur', cancel);
		view.removeEventListener('pagehide', cancel);
		if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
		handlers.end(cancelled);
	};
	const move = (next: PointerEvent) => { if (next.pointerId === pointerId) handlers.move(next); };
	const up = (next: PointerEvent) => { if (next.pointerId === pointerId) { handlers.move(next); finish(false); } };
	const cancelPointer = (next: PointerEvent) => { if (next.pointerId === pointerId) finish(true); };
	const cancel = () => finish(true);
	const keydown = (next: KeyboardEvent) => {
		if (next.key !== 'Escape') return;
		next.preventDefault();
		next.stopImmediatePropagation();
		finish(true);
	};
	event.preventDefault();
	target.setPointerCapture(pointerId);
	doc.addEventListener('pointermove', move);
	doc.addEventListener('pointerup', up);
	doc.addEventListener('pointercancel', cancelPointer);
	target.addEventListener('lostpointercapture', cancel);
	doc.addEventListener('keydown', keydown, true);
	view.addEventListener('blur', cancel);
	view.addEventListener('pagehide', cancel);
	return cancel;
}
