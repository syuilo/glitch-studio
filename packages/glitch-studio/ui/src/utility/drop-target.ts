export type DropTargetOptions<T> = {
	target: () => HTMLElement | null;
	enabled?: () => boolean;
	accepts: (event: DragEvent) => boolean;
	/** DataTransferはdropイベント中に読む。nullは取り込むデータがないことを表す。 */
	readDropData: (event: DragEvent) => T | null;
	onDrop: (data: T, event: DragEvent) => Promise<void>;
	onError: (error: unknown) => void;
	isApplicationBlocked?: () => boolean;
	onHoverChange: (hovering: boolean) => void;
};

/** DOMへの登録方式によらない、ドロップ受付とホバー・操作ロックの管理。 */
export function createDropTargetHandlers<T>(options: DropTargetOptions<T>) {
	let busy = false;
	let disposed = false;
	let depth = 0;
	let windowTarget: Window | null = null;
	const hideHover = () => options.onHoverChange(false);
	const clear = () => { depth = 0; hideHover(); };
	const isBlocked = () => busy || options.target()?.ownerDocument.body?.hasAttribute('inert') === true
		|| options.isApplicationBlocked?.() === true;

	function accept(event: DragEvent) {
		if (disposed || options.enabled?.() === false || !options.accepts(event)) return false;
		event.preventDefault();
		// 対象外の内部ドラッグは通し、受け付けたものは親や子の別処理へ渡さない。
		event.stopPropagation();
		if (event.dataTransfer != null) event.dataTransfer.dropEffect = isBlocked() ? 'none' : 'copy';
		return true;
	}

	function onDragenter(event: DragEvent) {
		if (!accept(event)) { clear(); return; }
		depth++;
		options.onHoverChange(!isBlocked());
	}

	function onDragover(event: DragEvent) {
		if (!accept(event)) { clear(); return; }
		options.onHoverChange(!isBlocked());
	}

	function onDragleave(event: DragEvent) {
		if (!accept(event)) return;
		depth = Math.max(0, depth - 1);
		// relatedTargetが得られる場合は領域外への移動を直接確認する。得られない場合も、
		// 子要素間のenter/leaveでオーバーレイがちらつかないよう最後のleaveだけで解除する。
		const next = event.relatedTarget;
		if (next != null ? options.target()?.contains(next as Node) !== true : depth === 0) clear();
	}

	async function onDrop(event: DragEvent) {
		clear();
		if (!accept(event) || isBlocked()) return;
		busy = true;
		try {
			const data = options.readDropData(event);
			if (data == null) return;
			// コピーとコールバックの開始は最初のawaitより前に行う。Dashboardの保存先
			// ハンドル取得も、DataTransferが利用できるdropイベント中に開始する必要がある。
			await options.onDrop(data, event);
		} catch (error) {
			options.onError(error);
		} finally {
			busy = false;
		}
	}

	function observeWindow() {
		if (disposed || windowTarget != null) return;
		windowTarget = options.target()?.ownerDocument.defaultView ?? null;
		// captureでは表示だけ隠し、受付側へイベントが届いた場合に再表示する。
		// 子の専用受付が伝播を止めた場合も、直前の親の表示を残さない。
		windowTarget?.addEventListener('dragover', hideHover, true);
		windowTarget?.addEventListener('dragenter', hideHover, true);
		windowTarget?.addEventListener('drop', clear, true);
		windowTarget?.addEventListener('dragend', clear, true);
		windowTarget?.addEventListener('blur', clear);
	}

	function dispose() {
		disposed = true;
		windowTarget?.removeEventListener('dragover', hideHover, true);
		windowTarget?.removeEventListener('dragenter', hideHover, true);
		windowTarget?.removeEventListener('drop', clear, true);
		windowTarget?.removeEventListener('dragend', clear, true);
		windowTarget?.removeEventListener('blur', clear);
		windowTarget = null;
		clear();
	}

	return {
		onDragenter,
		onDragover,
		onDragleave,
		onDrop,
		observeWindow,
		dispose,
	};
}
