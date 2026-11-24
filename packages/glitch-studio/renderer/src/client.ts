export function createTimelineRendererManagerWorker() {
	return new Worker(new URL('./timeline-renderer-manager-worker.ts', import.meta.url), {
		type: 'module',
	});
}

export function createEffectLivePreviewManagerWorker() {
	return new Worker(new URL('./effect-live-preview-manager-worker.ts', import.meta.url), {
		type: 'module',
	});
}

export function createMediaPlayerRendererWorker() {
	return new Worker(new URL('./media-player-renderer-worker.ts', import.meta.url), {
		type: 'module',
	});
}
