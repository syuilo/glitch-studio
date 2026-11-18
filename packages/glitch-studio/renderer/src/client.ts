export function createTimelineRendererManagerWorker() {
	return new Worker(new URL('./timeline-renderer-manager-worker.ts', import.meta.url), {
		type: 'module',
	});
}

export function createCustomNodeGraphEffectRendererManagerWorker() {
	return new Worker(new URL('./custom-node-graph-effect-renderer-manager-worker.ts', import.meta.url), {
		type: 'module',
	});
}
