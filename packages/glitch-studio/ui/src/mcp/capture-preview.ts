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
	const target = playback.mode === 'visualModuleLivePreview'
		? { kind: 'visualModule' as const, visualModuleId: playback.visualModuleId }
		: { kind: 'timeline' as const, sceneId: session.activeSceneId.value };
	const controller = session.activePreviewRenderer.value;
	const canvasRevision = controller.canvasRevision.value;
	const captured = await waitFor(playback.mode === 'visualModuleLivePreview'
		? session.visualModuleRendererManagerController.capturePreview(maximumSize)
		: session.timelineRendererManagerController.capturePreview(maximumSize, session.previewPlayback.currentTimelineTime.value), lifetime);
	lifetime.throwIfAborted();
	if (session.isDisposed || controller !== session.activePreviewRenderer.value || canvasRevision !== controller.canvasRevision.value
		|| (target.kind === 'visualModule' ? session.previewPlayback.visualModuleLivePreviewVisualModuleId.value !== target.visualModuleId : session.activeSceneId.value !== target.sceneId)) {
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
