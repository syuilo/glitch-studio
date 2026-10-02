export function dragListen(move: (ev: MouseEvent) => void, end?: () => void) {
	let active = true;
	// 登録時と同じ関数を解除し、ドラッグ終了後にリスナーを残さない。
	const clear = () => {
		if (!active) return;
		active = false;
		window.removeEventListener('mousemove', move);
		window.removeEventListener('mouseleave', clear);
		window.removeEventListener('mouseup', clear);
		end?.();
	};
	window.addEventListener('mousemove', move);
	window.addEventListener('mouseleave', clear);
	window.addEventListener('mouseup', clear);
	return clear;
}

