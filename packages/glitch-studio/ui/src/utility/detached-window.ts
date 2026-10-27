/** 親と同じスタイルを適用し、別ウィンドウでもパネルやアイコンを表示できるようにする。 */
export function prepareDetachedWindow(targetWindow: Window, title: string) {
	targetWindow.document.title = `Glitch Studio — ${title}`;
	for (const style of window.document.querySelectorAll('style, link[rel="stylesheet"]')) {
		targetWindow.document.head.append(style.cloneNode(true));
	}
}
