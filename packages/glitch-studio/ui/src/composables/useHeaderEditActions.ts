import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { DesktopEditCommand } from '@gs/glitch-studio_shared/desktop-edit.ts';
import type { EditorEditTarget } from './useEditorEditActions.ts';
import { isNativeTextEditingTarget } from '../utility/editor-edit-events.ts';

export function useHeaderEditActions(options: {
	editorTarget: Readonly<Ref<EditorEditTarget | null>>;
	executeNativeCommand: (command: DesktopEditCommand) => Promise<void>;
	reportError: (error: unknown) => void;
}) {
	const focusedElement = shallowRef<HTMLElement | null>(null);
	const selectedText = shallowRef(false);
	const nativeTextEditing = shallowRef(false);
	const writableTextInput = shallowRef(false);
	const nativeCanDelete = shallowRef(false);

	function updateSelection(event?: Event) {
		const nextTarget = event != null && 'relatedTarget' in event ? event.relatedTarget : null;
		if (event?.type === 'focusout' && nextTarget instanceof HTMLElement && nextTarget.closest('[data-editor-command-button]') != null) return;
		const activeElement = window.document.activeElement;
		// Tabでボタンへ移動しても、その直前の入力先と選択範囲を操作対象にする。
		if (activeElement instanceof HTMLElement && activeElement.closest('[data-editor-command-button]') == null) focusedElement.value = activeElement;
		const target = focusedElement.value;
		nativeTextEditing.value = isNativeTextEditingTarget(target);
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
			selectedText.value = target.selectionStart != null && target.selectionEnd != null && target.selectionStart !== target.selectionEnd;
			writableTextInput.value = !target.disabled && !target.readOnly && (target instanceof HTMLTextAreaElement || ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(target.type));
			nativeCanDelete.value = writableTextInput.value && target.value.length > 0;
		} else {
			selectedText.value = (window.document.getSelection()?.toString().length ?? 0) > 0;
			writableTextInput.value = target?.isContentEditable === true;
			nativeCanDelete.value = writableTextInput.value && (target?.textContent?.length ?? 0) > 0;
		}
	}

	const activeEditor = computed(() => {
		const editor = options.editorTarget.value;
		const target = focusedElement.value;
		return target != null && editor?.element.value?.contains(target) === true ? editor.actions : null;
	});
	const canCopy = computed(() => selectedText.value || (!nativeTextEditing.value && activeEditor.value?.canCopy() === true));
	const canPaste = computed(() => nativeTextEditing.value ? writableTextInput.value : activeEditor.value?.canPaste() === true);
	const canCut = computed(() => nativeTextEditing.value ? writableTextInput.value && selectedText.value : !selectedText.value && activeEditor.value?.canCut() === true);
	const canDelete = computed(() => nativeTextEditing.value ? nativeCanDelete.value : !selectedText.value && activeEditor.value?.canDelete() === true);
	const enabled = { copy: canCopy, paste: canPaste, cut: canCut, delete: canDelete };

	const selectionEvents = ['selectionchange', 'select', 'input', 'focusin', 'focusout'] as const;
	onMounted(() => {
		for (const event of selectionEvents) window.document.addEventListener(event, updateSelection, { capture: true });
		updateSelection();
	});
	onBeforeUnmount(() => {
		for (const event of selectionEvents) window.document.removeEventListener(event, updateSelection, { capture: true });
	});

	return {
		canCopy, canPaste, canCut, canDelete,
		async execute(command: DesktopEditCommand) {
			updateSelection();
			const target = focusedElement.value;
			if (!enabled[command].value || target == null || !target.isConnected) return;
			target.focus({ preventScroll: true });
			try {
				// Deleteには非編集要素で発生する標準DOMイベントがないため、キー操作と同じ削除関数を使う。
				// copy/paste/cutは必ずネイティブのDOMイベントを経由させ、ここではエディタの処理を直接呼ばない。
				if (command === 'delete' && !nativeTextEditing.value) activeEditor.value?.deleteSelection();
				else await options.executeNativeCommand(command);
			} catch (error) { options.reportError(error); }
		},
	};
}
