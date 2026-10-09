import { computed, onScopeDispose, shallowRef } from 'vue';

/** 選択・移動・シークの排他制御と、ドラッグ後のクリック抑止を一か所で所有する。 */
export function useTimelineInteraction() {
	const current = shallowRef<{ cancel: () => void } | null>(null);
	const active = computed(() => current.value != null);
	let disposed = false;
	let suppressClick = false;

	function begin(cancel: () => void): (() => void) | null {
		if (disposed || current.value != null) return null;
		const session = { cancel };
		current.value = session;
		// 範囲選択はpointerup後も計測を待つ。古い処理の完了で次の操作を解除しない。
		return () => { if (current.value === session) current.value = null; };
	}

	function onTimelineClick(event: MouseEvent) {
		if (!suppressClick) return;
		suppressClick = false;
		event.preventDefault();
		event.stopPropagation();
	}

	onScopeDispose(() => {
		disposed = true;
		current.value?.cancel();
		current.value = null;
	});

	return {
		active, begin, onTimelineClick,
		suppressNextClick: () => { suppressClick = true; },
		resetClickSuppression: () => { suppressClick = false; },
	};
}

export type TimelineInteraction = ReturnType<typeof useTimelineInteraction>;
