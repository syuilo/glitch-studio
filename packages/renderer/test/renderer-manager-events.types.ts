import type { VisualModuleRendererManager } from '../src/visual-module-renderer-manager.ts';
import type { TimelineRendererManager } from '../src/timeline-renderer-manager.ts';

declare const live: VisualModuleRendererManager;
declare const timeline: TimelineRendererManager;

// 【イベントの種類からpayloadを絞り込む】
// UIがキャストせずに扱え、種類と異なるpayloadを送る実装も検出できることを保証する。
live.on('ev', event => {
	if (event.type === 'renderError') {
		const message: string | null = event.ctx.message;
		void message;
	} else if (event.type === 'telemetry') {
		const fps: number = event.ctx.fpsAverage;
		void fps;
	} else if (event.type === 'effectState') {
		const nodeId: string = event.ctx.nodeId;
		void nodeId;
	}
});
timeline.on('ev', event => {
	if (event.type === 'renderError') {
		const message: string | null = event.ctx.message;
		void message;
	} else if (event.type === 'effectState') {
		const nodeId: string = event.ctx.nodeId;
		void nodeId;
	} else {
		const layerId: string = event.ctx.source.layerId;
		const clipId: string = event.ctx.source.clipId;
		void [layerId, clipId];
		// @ts-expect-error An effect layer does not have a node identity.
		void event.ctx.nodeId;
	}
});

// @ts-expect-error renderError cannot carry an effectState payload.
live.emit('ev', { type: 'renderError', ctx: { nodeId: 'node', status: null } });
// @ts-expect-error effectState cannot carry a renderError payload.
timeline.emit('ev', { type: 'effectState', ctx: { message: null } });
