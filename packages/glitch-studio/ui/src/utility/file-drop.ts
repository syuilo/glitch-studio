import type { InjectionKey } from 'vue';

/** 別ウィンドウへ移したビューにも、同じアプリのファイル取り込みを接続する。 */
export const fileDropTargetInstallerKey: InjectionKey<(target: HTMLElement) => () => void> = Symbol('fileDropTargetInstaller');

/** 子要素から伝播した外部ファイルを受け付ける。専用の受付はstopPropagationで全体受付を止める。 */
export function installFileDropHandlers(target: HTMLElement, onDrop: (files: File[], event: DragEvent) => Promise<void>, onError: (error: unknown) => void,
	isApplicationBlocked: () => boolean = () => false, onHoverChange: (hovering: boolean) => void = () => {}): () => void {
	let busy = false;
	const clearHover = () => onHoverChange(false);
	const windowTarget = target.ownerDocument.defaultView;
	const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
	const isBlocked = () => busy || target.ownerDocument.body.hasAttribute('inert') || isApplicationBlocked();
	const dragover = (event: DragEvent) => {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer != null) event.dataTransfer.dropEffect = isBlocked() ? 'none' : 'copy';
		onHoverChange(!isBlocked());
	};
	const dragenter = (event: DragEvent) => {
		if (isFileDrag(event)) onHoverChange(!isBlocked());
	};
	const dragleave = (event: DragEvent) => {
		if (!isFileDrag(event)) return;
		const next = event.relatedTarget;
		if (next == null || !target.contains(next as Node)) clearHover();
	};
	const drop = (event: DragEvent) => {
		clearHover();
		if (!isFileDrag(event)) return;
		event.preventDefault();
		event.stopPropagation();
		if (isBlocked()) return;
		// DataTransferはイベント中に読み取る。最初のawaitより後では取得できない。
		const files = Array.from(event.dataTransfer!.files);
		if (files.length === 0) return;
		busy = true;
		// ハンドル取得などDataTransferに依存する処理もdrop中に開始できるよう、同期で呼び出す。
		// eventのデータを読む場合は、コールバック内でも最初のawaitより前に取得すること。
		void onDrop(files, event).catch(onError).finally(() => { busy = false; });
	};
	target.addEventListener('dragover', dragover);
	target.addEventListener('dragenter', dragenter);
	target.addEventListener('dragleave', dragleave);
	target.addEventListener('drop', drop);
	// 表示だけをいったん消し、ルートまでバブリングした場合に再表示する。
	// 専用受付が伝播を止めた場合にも、直前の全体ホバー表示を残さないため。
	windowTarget?.addEventListener('dragover', clearHover, true);
	windowTarget?.addEventListener('dragenter', clearHover, true);
	windowTarget?.addEventListener('drop', clearHover, true);
	windowTarget?.addEventListener('dragend', clearHover, true);
	windowTarget?.addEventListener('blur', clearHover);
	return () => {
		target.removeEventListener('dragover', dragover);
		target.removeEventListener('dragenter', dragenter);
		target.removeEventListener('dragleave', dragleave);
		target.removeEventListener('drop', drop);
		windowTarget?.removeEventListener('dragover', clearHover, true);
		windowTarget?.removeEventListener('dragenter', clearHover, true);
		windowTarget?.removeEventListener('drop', clearHover, true);
		windowTarget?.removeEventListener('dragend', clearHover, true);
		windowTarget?.removeEventListener('blur', clearHover);
		clearHover();
	};
}
