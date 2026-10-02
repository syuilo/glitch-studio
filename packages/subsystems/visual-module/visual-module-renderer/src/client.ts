export function createVisualModuleRendererManagerWorker() {
	return new Worker(new URL('./visual-module-renderer-manager-worker.ts', import.meta.url), {
		type: 'module',
	});
}
