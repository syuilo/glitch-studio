import { inject, onBeforeUnmount } from 'vue';
import type { InjectionKey, Ref, ShallowRef } from 'vue';
import { createEditorEditEventHandlers, isNativeTextEditingTarget } from '../utility/editor-edit-events.ts';
import type { EditorEditActions } from '../utility/editor-edit-events.ts';

export type EditorEditTarget = {
	element: Readonly<Ref<HTMLElement | null>>;
	actions: EditorEditActions;
};

export const editorEditTargetKey: InjectionKey<ShallowRef<EditorEditTarget | null>> = Symbol('editorEditTarget');

/** ヘッダーへ移動しても、最後に操作したエディタの選択と貼り付け先を維持する。 */
export function useEditorEditActions(element: Readonly<Ref<HTMLElement | null>>, actions: EditorEditActions) {
	const activeTarget = inject(editorEditTargetKey, null);
	const target = { element, actions };
	onBeforeUnmount(() => {
		// 別のエディタへ切り替えた後のアンマウントでは、そのエディタの操作先を消さない。
		if (activeTarget?.value === target) activeTarget.value = null;
	});
	return {
		...createEditorEditEventHandlers(actions),
		activate(event: Event) {
			if (activeTarget != null) activeTarget.value = target;
			// 非編集要素のポイントや行を選んだ場合も、ネイティブ編集イベントの配送先をエディタ内にする。
			if (event.type === 'pointerdown' && !isNativeTextEditingTarget(event.target)) element.value?.focus({ preventScroll: true });
		},
	};
}
