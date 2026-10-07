import { validateTimelineText } from '@gs/subsystems_timeline_shared/layers/text/text-layer.ts';
import { TextParameters } from './text-parameters.ts';
import { createTextRenderer } from './text-renderer.ts';
import { createTimelineCompositor } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import type { TimelineTextLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { TimelineLayerRenderer } from '../../timeline-renderer.ts';

export function createTextTimelineLayer(layer: TimelineTextLayer, options: Parameters<typeof createTextRenderer>[0] & { getFont: (id: string) => Blob | null }): TimelineLayerRenderer<UniformOrTexture> {
	validateTimelineText(layer.textParamValues);
	const renderer = createTextRenderer(options);
	const compositor = createTimelineCompositor(options);
	const parameters = new TextParameters();
	const compositing = new TimelineCompositingParameters();
	let disposed = false;
	return {
		async evaluate(context, signal) {
			if (disposed || signal.aborted) return { gpuTime: 0 };
			const scope = { time: context.sceneTimeMs, isExport: context.isExport, automationGraphs: layer.automationGraphs };
			const text = parameters.evaluate(layer.textParamValues, scope);
			if (!await renderer.prepare(text.font == null ? null : options.getFont(text.font), signal) || disposed || signal.aborted) return { gpuTime: 0 };
			const settings = compositing.evaluate({ ...scope, paramValues: layer.compositingParamValues });
			const encoder = options.device.createCommandEncoder();
			try {
				const texture = renderer.render(encoder, text);
				return { output: compositor.render(encoder, context.input, { kind: 'texture', texture }, settings), gpuTime: 0 };
			} finally {
				// クリップごとの借用出力を、次の評価や破棄より前に読み終える順序を保証する。
				options.device.queue.submit([encoder.finish()]);
			}
		},
		destroy() {
			disposed = true;
			renderer.dispose();
			compositor.dispose();
		},
	};
}
