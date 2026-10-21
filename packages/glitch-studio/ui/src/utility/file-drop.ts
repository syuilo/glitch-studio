import type { InjectionKey } from 'vue';
import { createDropTargetHandlers } from './drop-target.ts';

/** 別ウィンドウへ移したビューにも、同じアプリのファイル取り込みを接続する。 */
export const fileDropTargetInstallerKey: InjectionKey<(target: HTMLElement) => () => void> = Symbol('fileDropTargetInstaller');

/** 共通の受付処理を、DOMの通常バブリングへ接続するファイル専用の入口。 */
export function installFileDropHandlers(target: HTMLElement, onDrop: (files: File[], event: DragEvent) => Promise<void>, onError: (error: unknown) => void,
	isApplicationBlocked: () => boolean = () => false, onHoverChange: (hovering: boolean) => void = () => {}): () => void {
	const handlers = createDropTargetHandlers({
		target: () => target,
		accepts: event => event.dataTransfer?.types.includes('Files') === true,
		readDropData: event => {
			const files = Array.from(event.dataTransfer?.files ?? []);
			return files.length > 0 ? files : null;
		},
		onDrop,
		onError,
		isApplicationBlocked,
		onHoverChange,
	});
	target.addEventListener('dragover', handlers.onDragover);
	target.addEventListener('dragenter', handlers.onDragenter);
	target.addEventListener('dragleave', handlers.onDragleave);
	target.addEventListener('drop', handlers.onDrop);
	handlers.observeWindow();
	return () => {
		target.removeEventListener('dragover', handlers.onDragover);
		target.removeEventListener('dragenter', handlers.onDragenter);
		target.removeEventListener('dragleave', handlers.onDragleave);
		target.removeEventListener('drop', handlers.onDrop);
		handlers.dispose();
	};
}
