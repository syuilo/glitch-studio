export function dragListen(move: (ev: MouseEvent) => void, end?: () => void, ownerWindow: Window = window) {
	let active = true;
	// 登録時と同じ関数を解除し、ドラッグ終了後にリスナーを残さない。
	const clear = () => {
		if (!active) return;
		active = false;
		ownerWindow.removeEventListener('mousemove', move);
		ownerWindow.removeEventListener('mouseleave', clear);
		ownerWindow.removeEventListener('mouseup', clear);
		end?.();
	};
	ownerWindow.addEventListener('mousemove', move);
	ownerWindow.addEventListener('mouseleave', clear);
	ownerWindow.addEventListener('mouseup', clear);
	return clear;
}

