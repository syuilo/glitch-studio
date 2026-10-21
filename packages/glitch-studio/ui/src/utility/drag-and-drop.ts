import { shallowRef } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';

export type DragDataMap = {
	GsDraggable: { item: { id: string }; group: string; };
	WorkspacePanel: { id: string; };
	GsAsset: { assetId: string; };
	TimelineLayer: { sceneId: string; layerId: string; };
};

type DragSession = {
	sourceId: string;
	type: keyof DragDataMap;
	data: DragDataMap[keyof DragDataMap];
	serialized: string;
	marker: string;
	onDrop: (() => void) | null;
	finishAfterDrop: () => void;
	dispose: () => void;
};

let currentSession: DragSession | null = null;
const visibleSession = shallowRef<DragSession | null>(null);

function finishSession(session: DragSession) {
	if (currentSession !== session) return;
	currentSession = null;
	visibleSession.value = null;
	session.dispose();
}

/** 内部ドラッグを識別する印をtypesに入れる。型だけの一致では、古いセッションや外部ドラッグを誤認する。 */
function matchesSession(event: DragEvent, session: DragSession) {
	return event.dataTransfer?.types.includes(session.marker) === true;
}

export function startDragSession<T extends keyof DragDataMap>(event: DragEvent, sourceId: string, type: T, data: DragDataMap[T], onDrop: (() => void) | null = null): boolean {
	if (event.dataTransfer == null) return false;
	if (currentSession != null) finishSession(currentSession);
	const serialized = setDragData(event, type, data);
	if (serialized == null) return false;
	const marker = `glitch-studio/drag-session-${genId()}`.toLowerCase();
	event.dataTransfer.setData(marker, marker);
	const source = (event.currentTarget ?? event.target) as HTMLElement | null;
	const ownerWindow = source?.ownerDocument?.defaultView ?? null;
	const session: DragSession = {
		sourceId,
		type,
		data: JSON.parse(serialized),
		serialized,
		marker,
		onDrop,
		finishAfterDrop: () => {},
		dispose: () => {},
	};
	const finish = () => finishSession(session);
	let dropTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
	// ネイティブイベントではリスナー間にもmicrotaskが実行され得るため、次のタスクまで待つ。
	// captureで終了を観測しても、targetやbubbleのハンドラーがデータを読む前に破棄しない。
	session.finishAfterDrop = () => { if (dropTimer == null) dropTimer = globalThis.setTimeout(finish, 0); };
	const onWindowDrop = (event: DragEvent) => { if (matchesSession(event, session)) session.finishAfterDrop(); };
	const onWindowDragend = (event: DragEvent) => { if (event.dataTransfer == null || matchesSession(event, session)) finish(); };
	// 別種別のドラッグ開始でも、前の終了イベントが失われたセッションを持ち越さない。
	ownerWindow?.addEventListener('dragstart', finish, true);
	ownerWindow?.addEventListener('dragend', onWindowDragend, true);
	ownerWindow?.addEventListener('drop', onWindowDrop, true);
	ownerWindow?.addEventListener('blur', finish);
	// Chromeではdragstart中のDOM変更がドラッグを中断する場合がある。
	// 読み出しは即時に可能とし、DOMを変えるリアクティブな公開だけを遅らせる。
	// SEE: https://stackoverflow.com/questions/19639969/html5-dragend-event-firing-immediately
	// SEE: https://issues.chromium.org/issues/41150279
	const timer = globalThis.setTimeout(() => {
		if (currentSession === session) visibleSession.value = session;
	}, 10);
	session.dispose = () => {
		globalThis.clearTimeout(timer);
		if (dropTimer != null) globalThis.clearTimeout(dropTimer);
		ownerWindow?.removeEventListener('dragstart', finish, true);
		ownerWindow?.removeEventListener('dragend', onWindowDragend, true);
		ownerWindow?.removeEventListener('drop', onWindowDrop, true);
		ownerWindow?.removeEventListener('blur', finish);
	};
	currentSession = session;
	return true;
}

/** protectedモードのdragoverでも、同じ内部セッションのスナップショットを読み出せる。 */
export function getActiveDragData<T extends keyof DragDataMap>(event: DragEvent, type: T, sourceId: string | null = null): Readonly<DragDataMap[T]> | null {
	const session = currentSession;
	if (session == null || session.type !== type || (sourceId != null && session.sourceId !== sourceId) || !matchesSession(event, session)) return null;
	if (!checkDragDataType(event, [type])) return null;
	// dropではブラウザ側のデータも読める。開始後に書き換わったデータを古いキャッシュで補わない。
	if (event.type === 'drop') {
		// 別ウィンドウの受付から読み出した場合も、全ハンドラーが読み終わるまで待って終了する。
		session.finishAfterDrop();
		if (event.dataTransfer?.getData(`glitch-studio/${type}`.toLowerCase()) !== session.serialized) return null;
	}
	return session.data as DragDataMap[T];
}

/** UIはこの値からドラッグ元IDや受付領域を算出し、独自のドラッグ状態を持たない。 */
export function getDragSessionData<T extends keyof DragDataMap>(type: T, sourceId: string | null = null): Readonly<DragDataMap[T]> | null {
	const session = visibleSession.value;
	return session == null || session.type !== type || (sourceId != null && session.sourceId !== sourceId) ? null : session.data as DragDataMap[T];
}

export function finishDragSession(sourceId: string) {
	if (currentSession?.sourceId === sourceId) finishSession(currentSession);
}

/** 他インスタンスへの移動の確定通知だけを開始元へ返し、キャンセル時には通知しない。 */
export function completeDragSession(event: DragEvent, targetSourceId: string) {
	const session = currentSession;
	if (session == null || getActiveDragData(event, session.type) == null) return;
	try {
		if (session.sourceId !== targetSourceId) session.onDrop?.();
	} finally { finishSession(session); }
}

// NOTE: dataTransfer の format は大文字小文字区別されないっぽいので toLowerCase が必要

export function setDragData<T extends keyof DragDataMap>(
	event: DragEvent,
	type: T,
	data: DragDataMap[T],
) {
	if (event.dataTransfer == null) return null;

	const serialized = JSON.stringify(data);
	event.dataTransfer.setData(`glitch-studio/${type}`.toLowerCase(), serialized);
	return serialized;
}

export function setPlainDragData(
	event: DragEvent,
	data: string,
) {
	if (event.dataTransfer == null) return;

	event.dataTransfer.setData('text/plain', data);
}

export function getDragData<T extends keyof DragDataMap>(
	event: DragEvent,
	type: T,
): DragDataMap[T] | null {
	if (event.dataTransfer == null) return null;

	const data = event.dataTransfer.getData(`glitch-studio/${type}`.toLowerCase());
	if (data == null || data === '') return null;

	return JSON.parse(data);
}

export function getPlainDragData(
	event: DragEvent,
): string | null {
	if (event.dataTransfer == null) return null;

	const data = event.dataTransfer.getData('text/plain');
	if (data == null || data === '') return null;

	return data;
}

export function checkDragDataType(
	event: DragEvent,
	types: (keyof DragDataMap)[],
): boolean {
	if (event.dataTransfer == null) return false;

	return event.dataTransfer.types.some(dataType => types.some(type => `glitch-studio/${type}`.toLowerCase() === dataType.toLowerCase()));
}
