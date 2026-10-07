/** Pointer Captureで要素外・タッチの移動も追跡し、終了時に必ずリスナーを解除する。 */
export function listenPointerDrag(event: PointerEvent, move: (event: PointerEvent) => void, end: () => void,
	element = event.currentTarget as HTMLElement, options: { captureAfterDistance?: number } = {}): () => void {
	const pointerId = event.pointerId;
	const captureAfterDistance = options.captureAfterDistance ?? 0;
	// 別ウィンドウへ移された要素のイベントは元のwindowには届かない。
	// 開始時の所属ウィンドウを保持し、DOMが戻された場合も登録先から解除する。
	const ownerWindow = element.ownerDocument.defaultView;
	let active = true;
	let captureStarted = false;
	const capture = () => {
		element.setPointerCapture(pointerId);
		captureStarted = true;
	};
	const onMove = (current: PointerEvent) => {
		if (current.pointerId !== pointerId) return;
		// 親要素でのCaptureはclick/dblclickの宛先も変えるため、必要な場合はドラッグ開始まで待つ。
		// 捕捉前も所属ウィンドウで追跡し、元の子要素からポインターが外れた場合に対応する。
		if (!captureStarted && Math.hypot(current.clientX - event.clientX, current.clientY - event.clientY) >= captureAfterDistance) capture();
		move(current);
	};
	const finish = () => {
		if (!active) return;
		active = false;
		ownerWindow?.removeEventListener('pointermove', onMove);
		ownerWindow?.removeEventListener('pointerup', onUp);
		ownerWindow?.removeEventListener('pointercancel', onCancel);
		ownerWindow?.removeEventListener('blur', finish);
		ownerWindow?.removeEventListener('pagehide', finish);
		element.removeEventListener('lostpointercapture', onLostCapture);
		if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
		end();
	};
	const onUp = (event: PointerEvent) => { if (event.pointerId === pointerId) { move(event); finish(); } };
	const onCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(); };
	// タッチによる子要素の暗黙のCaptureを親へ移した際、子からバブルする喪失通知では終了しない。
	const onLostCapture = (event: PointerEvent) => { if (event.target === element) onCancel(event); };
	if (captureAfterDistance <= 0) capture();
	ownerWindow?.addEventListener('pointermove', onMove);
	ownerWindow?.addEventListener('pointerup', onUp);
	ownerWindow?.addEventListener('pointercancel', onCancel);
	ownerWindow?.addEventListener('blur', finish);
	ownerWindow?.addEventListener('pagehide', finish);
	element.addEventListener('lostpointercapture', onLostCapture);
	return finish;
}
