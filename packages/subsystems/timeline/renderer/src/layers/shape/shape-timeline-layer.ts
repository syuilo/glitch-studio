import { validateTimelineShape } from '@gs/subsystems_timeline_shared/layers/shape/shape-layer.ts';
import { ShapeParameters } from './shape-parameters.ts';
import { createShapeRenderer } from './shape-renderer.ts';
import { createTimelineCompositor } from '../../timeline-compositor.ts';
import type { TimelineCompositingObserver } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import type { TimelineShapeLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { TimelineLayerRenderer } from '../../timeline-renderer.ts';

export function createShapeTimelineLayer(layer: TimelineShapeLayer, options: Parameters<typeof createShapeRenderer>[0] & { onCompositing?: TimelineCompositingObserver }): TimelineLayerRenderer<UniformOrTexture> {
	validateTimelineShape(layer.shape);
	const renderer = createShapeRenderer(options);
	const compositor = createTimelineCompositor(options);
	const parameters = new ShapeParameters();
	const compositing = new TimelineCompositingParameters();
	let disposed = false;
	return {
		async evaluate(context, signal) {
			if (disposed || signal.aborted) return { gpuTime: 0 };
			const scope = { time: context.sceneTimeMs, isExport: context.isExport, automationGraphs: layer.automationGraphs };
			const shape = parameters.evaluate(layer.shape, scope);
			const settings = compositing.evaluate({ ...scope, paramValues: layer.compositingParamValues });
			const encoder = options.device.createCommandEncoder();
			try {
				const texture = renderer.render(encoder, shape);
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
