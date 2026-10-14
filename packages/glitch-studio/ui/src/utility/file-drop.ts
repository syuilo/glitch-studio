import type { InjectionKey } from 'vue';

/** 別ウィンドウへ移したビューにも、同じアプリのファイル取り込みを接続する。 */
export const fileDropTargetInstallerKey: InjectionKey<(target: HTMLElement) => () => void> = Symbol('fileDropTargetInstaller');

/** 子要素から伝播した外部ファイルを受け付ける。専用の受付はstopPropagationで全体受付を止める。 */
export function installFileDropHandlers(target: HTMLElement, onDrop: (files: File[]) => Promise<void>, onError: (error: unknown) => void, isApplicationBlocked: () => boolean = () => false): () => void {
	let busy = false;
	const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
	const isBlocked = () => busy || target.ownerDocument.body.hasAttribute('inert') || isApplicationBlocked();
	const dragover = (event: DragEvent) => {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer != null) event.dataTransfer.dropEffect = isBlocked() ? 'none' : 'copy';
	};
	const drop = (event: DragEvent) => {
		if (!isFileDrag(event)) return;
		event.preventDefault();
		event.stopPropagation();
		if (isBlocked()) return;
		// DataTransferはイベント中に読み取る。最初のawaitより後では取得できない。
		const files = Array.from(event.dataTransfer!.files);
		if (files.length === 0) return;
		busy = true;
		void onDrop(files).catch(onError).finally(() => { busy = false; });
	};
	target.addEventListener('dragover', dragover);
	target.addEventListener('drop', drop);
	return () => {
		target.removeEventListener('dragover', dragover);
		target.removeEventListener('drop', drop);
	};
}
