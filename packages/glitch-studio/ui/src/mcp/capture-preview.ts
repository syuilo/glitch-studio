import { nextTick, watch } from 'vue';
import type { ProjectSessionContext } from '../ProjectSessionContext.ts';

function waitFor<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const cancel = () => reject(signal.reason);
		signal.addEventListener('abort', cancel, { once: true });
		operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
	});
}

/** 通常のシークと同じ操作を行い、操作後の表示時刻に対応する画像だけを返す。 */
export async function seekTimelineAndCapture(session: ProjectSessionContext, sceneId: string, requestedTimeMs: number, maximumSize: number,
	signal: AbortSignal, capturePreview = captureProjectPreview) {
	signal.throwIfAborted();
	if (session.isDisposed || session.activeSceneId.value !== sceneId) throw new Error('SCENE_NOT_ACTIVE: Select the requested Scene before seeking.');
	if (!Number.isFinite(requestedTimeMs) || requestedTimeMs < 0) throw new Error('Invalid timeline time.');
	if (!Number.isSafeInteger(maximumSize) || maximumSize < 64 || maximumSize > 2048) throw new Error('maximumSize must be an integer between 64 and 2048.');
	const wasPlaying = session.previewPlayback.isTimelinePlaying.value;
	session.previewPlayback.pauseTimeline();
	session.previewPlayback.seekTimeline(requestedTimeMs);
	const actualTimeMs = session.previewPlayback.currentTimelineTime.value;
	let changed = false;
	// 一度別の位置へ移動してから戻っても、途中の描画と結果を混同しない。
	// 中断時に元の時刻を復元すると、後から行われた手動操作を上書きしてしまう。
	const stopWatch = watch(() => [session.activeSceneId.value, session.previewPlayback.state.value.mode,
		session.previewPlayback.isTimelinePlaying.value, session.previewPlayback.currentTimelineTime.value],
		() => { changed = true; }, { flush: 'sync' });
	try {
		const image = await capturePreview(session, maximumSize, signal);
		signal.throwIfAborted();
		if (changed || session.isDisposed || session.activeSceneId.value !== sceneId || image.target.kind !== 'timeline'
			|| image.target.sceneId !== sceneId || image.timeMs == null || Math.abs(image.timeMs - actualTimeMs) > 1e-7) {
			throw new Error('PREVIEW_CHANGED: The timeline or captured frame changed while seeking.');
		}
		return { ...image, requestedTimeMs, wasPlaying };
	} finally { stopWatch(); }
}

/** スナップショット用にプレビューを切り替えず、現在表示している作品の新しいフレームを取得する。 */
export async function captureProjectPreview(session: ProjectSessionContext, maximumSize: number, signal: AbortSignal) {
	const lifetime = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
	lifetime.throwIfAborted();
	if (!Number.isSafeInteger(maximumSize) || maximumSize < 64 || maximumSize > 2048) throw new Error('maximumSize must be an integer between 64 and 2048.');
	await nextTick();
	await waitFor(session.flushRendererProjectChanges(), lifetime);
	if (!session.renderEngine.canRender.value && session.renderEngine.errorMessage.value == null && !session.renderEngine.isSuspended.value) {
		// 解像度などの静的設定変更ではWorkerを再生成する。旧Canvasを撮らず、新世代の
		// 起動を待つ。エラー時の自動再試行は行わず、通常のプレビュー復旧操作に任せる。
		const watcher = { stop: null as (() => void) | null };
		try {
			await waitFor(new Promise<void>(resolve => {
				watcher.stop = watch(() => session.renderEngine.canRender.value || session.renderEngine.errorMessage.value != null || session.renderEngine.isSuspended.value,
					ready => { if (ready) resolve(); }, { immediate: true });
			}), lifetime);
		} finally { watcher.stop?.(); }
	}
	if (session.isDisposed || !session.renderEngine.canRender.value) throw new Error(session.renderEngine.errorMessage.value ?? 'PREVIEW_UNAVAILABLE: The preview is not ready.');
	await waitFor(session.flushRendererProjectChanges(), lifetime);
	const playback = session.previewPlayback.state.value;
	const target = playback.mode === 'customNodeGraphEffectLivePreview'
		? { kind: 'customNodeGraphEffect' as const, customNodeGraphEffectId: playback.customNodeGraphEffectId }
		: { kind: 'timeline' as const, sceneId: session.activeSceneId.value };
	const controller = session.activePreviewRenderer.value;
	const canvasRevision = controller.canvasRevision.value;
	const captured = await waitFor(playback.mode === 'customNodeGraphEffectLivePreview'
		? session.effectLivePreviewManagerController.capturePreview(maximumSize)
		: session.timelineRendererManagerController.capturePreview(maximumSize, session.previewPlayback.currentTimelineTime.value), lifetime);
	lifetime.throwIfAborted();
	if (session.isDisposed || controller !== session.activePreviewRenderer.value || canvasRevision !== controller.canvasRevision.value
		|| (target.kind === 'customNodeGraphEffect' ? session.previewPlayback.livePreviewCustomNodeGraphEffectId.value !== target.customNodeGraphEffectId : session.activeSceneId.value !== target.sceneId)) {
		throw new Error('PREVIEW_CHANGED: The preview changed while capturing an image.');
	}
	if (captured == null) throw new Error('PREVIEW_UNAVAILABLE: No new preview frame could be captured.');
	const bytes = new Uint8Array(await captured.blob.arrayBuffer());
	lifetime.throwIfAborted();
	// IPCへBlobやファイルパスを公開せず、MCP画像コンテンツにそのまま使えるPNGを返す。
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
	return { data: btoa(binary), mimeType: 'image/png' as const, width: captured.width, height: captured.height,
		projectSessionId: session.id, target, timeMs: captured.time, colorSpace: 'srgb', includesPreviewAdjustments: true };
}
