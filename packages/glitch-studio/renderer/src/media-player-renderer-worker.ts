import { MediaPlayerRenderer } from './media-player-renderer.ts';
import type { MediaPlayerRendererOptions } from './media-player-renderer.ts';

let renderer: MediaPlayerRenderer | null = null;

self.onmessage = async ({ data }) => {
	try {
		if (data.type === 'init') {
			renderer = await MediaPlayerRenderer.create(data.rendererOptions as MediaPlayerRendererOptions);
			renderer.on('ev', ev => self.postMessage({ type: 'ev', ev }, {
				transfer: ev.type === 'cpuPreviewFrame' ? [ev.ctx.pixels] : [],
			}));
			self.postMessage({ type: 'inited' });
			return;
		}
		if (renderer == null) throw new Error('Media Player renderer is not initialized');
		const method = Reflect.get(renderer, data.fn);
		if (typeof method !== 'function') throw new Error(`Unknown Media Player renderer method: ${data.fn}`);
		const value = await Reflect.apply(method, renderer, data.args);
		if (data.needReturnValue) self.postMessage({ type: 'return', id: data.id, success: true, value });
	} catch (error) {
		const reason = error instanceof Error ? error : new Error(String(error));
		if (data.type === 'init') self.postMessage({ type: 'initError', message: reason.message });
		else if (data.needReturnValue) self.postMessage({ type: 'return', id: data.id, success: false, error: reason });
		else self.postMessage({ type: 'callError', message: reason.message });
	}
};
