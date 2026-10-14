import type { InjectionKey } from 'vue';

/** 別ウィンドウへ移したビューにも、同じアプリのファイル取り込みを接続する。 */
export const fileDropDocumentInstallerKey: InjectionKey<(document: Document) => () => void> = Symbol('fileDropDocumentInstaller');

/** 子パネルが伝播を止めても外部ファイルを受け付け、アプリ内のドラッグはそのまま通す。 */
export function installFileDropHandlers(document: Document, onDrop: (files: File[]) => Promise<void>, onError: (error: unknown) => void, isApplicationBlocked: () => boolean = () => false): () => void {
	let busy = false;
	const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
	// 専用のドロップ対象では、そのコンポーネント自身に受付を任せる。
	// instanceof Elementは別ウィンドウの要素を判定できないため、属性の有無を調べる。
	const hasDedicatedTarget = (event: DragEvent) => event.composedPath().some(target =>
		'hasAttribute' in target && typeof target.hasAttribute === 'function' && target.hasAttribute('data-file-drop-target') === true);
	const isBlocked = () => busy || document.body.hasAttribute('inert') || isApplicationBlocked();
	const dragover = (event: DragEvent) => {
		if (!isFileDrag(event) || hasDedicatedTarget(event)) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer != null) event.dataTransfer.dropEffect = isBlocked() ? 'none' : 'copy';
	};
	const drop = (event: DragEvent) => {
		if (!isFileDrag(event) || hasDedicatedTarget(event)) return;
		event.preventDefault();
		event.stopPropagation();
		if (isBlocked()) return;
		// DataTransferはイベント中に読み取る。最初のawaitより後では取得できない。
		const files = Array.from(event.dataTransfer!.files);
		if (files.length === 0) return;
		busy = true;
		void onDrop(files).catch(onError).finally(() => { busy = false; });
	};
	document.addEventListener('dragover', dragover, { capture: true });
	document.addEventListener('drop', drop, { capture: true });
	return () => {
		document.removeEventListener('dragover', dragover, { capture: true });
		document.removeEventListener('drop', drop, { capture: true });
	};
}
