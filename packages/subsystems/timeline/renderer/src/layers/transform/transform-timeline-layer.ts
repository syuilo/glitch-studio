import { getTimelineRenderLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { TimelineTransformParameters } from '@gs/subsystems_timeline_shared/layers/transform/transform-parameters.ts';
import { getTimelineTransformSpace } from '@gs/subsystems_timeline_shared/transform-space.ts';
import { TimelineRenderer } from '../../timeline-renderer.ts';
import type { TimelineLayerRenderer } from '../../timeline-renderer.ts';
import type { TimelineLayer, TimelineTransformLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

/** 子の合成結果をそのまま返す。Groupのような中間画像や追加の合成パスは作らない。 */
export function createTransformTimelineLayer<Output>(getTransform: () => TimelineTransformLayer, options: {
	resolution: Resolution;
	fallbackOutput: Output;
	createLayer: (layer: TimelineLayer, clipId: string | null) => TimelineLayerRenderer<Output>;
	getLayerVersion?: (layer: TimelineLayer, clipId: string | null) => string | number;
}): TimelineLayerRenderer<Output> {
	const renderer = new TimelineRenderer<Output, TimelineLayer>(options);
	const parameters = new TimelineTransformParameters();
	return {
		createChildren(context, evaluation) {
			const layer = getTransform();
			const transform = parameters.evaluate(layer.transformParamValues, layer.automationGraphs, context.sceneTimeMs, context.isExport, context.customParameters);
			return renderer.createEvaluation(getTimelineRenderLayers(layer.layers), {
				...evaluation,
				time: context.sceneTimeMs,
				timeDelta: context.timeDelta,
				referenceTime: context.referenceTime != null ? { timeMs: context.referenceTime.sceneTimeMs, timeDelta: context.referenceTime.timeDelta } : undefined,
				renderSpace: getTimelineTransformSpace(transform, options.resolution, context.renderSpace),
				getInput: context.getInput,
			});
		},
		async evaluate(context, signal) {
			// 親の背景を初期入力にすることで、Transform内のEffectも外側の下層を参照する。
			// 子が返す透明画像（replaceも可能）と、有効な子がない状態は区別する。
			const result = await context.childEvaluation!.evaluate();
			if (signal.aborted) return { gpuTime: 0 };
			return { output: result.hasOutput ? result.output : null, gpuTime: 0 };
		},
		destroy() { renderer.clear(); },
	};
}
