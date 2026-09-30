/** Pointer Captureで要素外・タッチの移動も追跡し、終了時に必ずリスナーを解除する。 */
export function listenPointerDrag(event: PointerEvent, move: (event: PointerEvent) => void, end: () => void, element = event.currentTarget as HTMLElement): () => void {
	const pointerId = event.pointerId;
	let active = true;
	const onMove = (event: PointerEvent) => { if (event.pointerId === pointerId) move(event); };
	const finish = () => {
		if (!active) return;
		active = false;
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
		window.removeEventListener('pointercancel', onCancel);
		window.removeEventListener('blur', finish);
		element.removeEventListener('lostpointercapture', onCancel);
		if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
		end();
	};
	const onUp = (event: PointerEvent) => { if (event.pointerId === pointerId) { move(event); finish(); } };
	const onCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(); };
	element.setPointerCapture(pointerId);
	window.addEventListener('pointermove', onMove);
	window.addEventListener('pointerup', onUp);
	window.addEventListener('pointercancel', onCancel);
	window.addEventListener('blur', finish);
	element.addEventListener('lostpointercapture', onCancel);
	return finish;
}
