/** Pointer Captureで要素外・タッチの移動も追跡し、終了時に必ずリスナーを解除する。 */
export function listenPointerDrag(event: PointerEvent, move: (event: PointerEvent) => void, end: () => void, element = event.currentTarget as HTMLElement): () => void {
	const pointerId = event.pointerId;
	// 別ウィンドウへ移された要素のイベントは元のwindowには届かない。
	// 開始時の所属ウィンドウを保持し、DOMが戻された場合も登録先から解除する。
	const ownerWindow = element.ownerDocument.defaultView;
	let active = true;
	const onMove = (event: PointerEvent) => { if (event.pointerId === pointerId) move(event); };
	const finish = () => {
		if (!active) return;
		active = false;
		ownerWindow?.removeEventListener('pointermove', onMove);
		ownerWindow?.removeEventListener('pointerup', onUp);
		ownerWindow?.removeEventListener('pointercancel', onCancel);
		ownerWindow?.removeEventListener('blur', finish);
		ownerWindow?.removeEventListener('pagehide', finish);
		element.removeEventListener('lostpointercapture', onCancel);
		if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
		end();
	};
	const onUp = (event: PointerEvent) => { if (event.pointerId === pointerId) { move(event); finish(); } };
	const onCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(); };
	element.setPointerCapture(pointerId);
	ownerWindow?.addEventListener('pointermove', onMove);
	ownerWindow?.addEventListener('pointerup', onUp);
	ownerWindow?.addEventListener('pointercancel', onCancel);
	ownerWindow?.addEventListener('blur', finish);
	ownerWindow?.addEventListener('pagehide', finish);
	element.addEventListener('lostpointercapture', onCancel);
	return finish;
}
