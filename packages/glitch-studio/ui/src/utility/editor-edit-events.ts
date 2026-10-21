export type EditorEditActions = {
	canCopy: () => boolean;
	copySelection: () => void;
	canPaste: () => boolean;
	paste: () => void | Promise<void>;
	canCut: () => boolean;
	cutSelection: () => void;
	canDelete: () => boolean;
	deleteSelection: () => void;
};

export function isNativeTextEditingTarget(target: EventTarget | null): target is HTMLElement {
	return target instanceof HTMLElement && (target.closest('input, textarea, select') != null || target.isContentEditable);
}

/** コピー内容の保存先には触れず、ブラウザの編集イベントをエディタの操作へ接続する。 */
export function createEditorEditEventHandlers(actions: EditorEditActions) {
	function shouldHandle(event: Event) {
		if (event.defaultPrevented || isNativeTextEditingTarget(event.target)) return false;
		// ラベルなどの文字列を選択している場合も、ブラウザの標準操作を優先する。
		return (window.document.getSelection()?.toString().length ?? 0) === 0;
	}

	function consume(event: Event) {
		event.preventDefault();
		event.stopPropagation();
	}

	return {
		onCopy(event: ClipboardEvent) {
			if (!shouldHandle(event) || !actions.canCopy()) return;
			consume(event);
			actions.copySelection();
		},
		onPaste(event: ClipboardEvent) {
			if (!shouldHandle(event) || !actions.canPaste()) return;
			// 非同期の素材読み込みに入る前に標準動作を止める。
			consume(event);
			return actions.paste();
		},
		onCut(event: ClipboardEvent) {
			if (!shouldHandle(event) || !actions.canCut()) return;
			consume(event);
			actions.cutSelection();
		},
		onKeydown(event: KeyboardEvent) {
			if (!shouldHandle(event) || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
			if ((event.key !== 'Delete' && event.key !== 'Backspace') || !actions.canDelete()) return;
			consume(event);
			// 一度キーを消した後に所属レイヤーへ選択が戻っても、押し続けでレイヤーまで消さない。
			if (!event.repeat) actions.deleteSelection();
		},
	};
}
