import { isTimelineRenderLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { getTimelineGroupSpace } from '@gs/subsystems_timeline_shared/group-space.ts';
import { TimelineRenderer, type TimelineLayerRenderer } from '../../timeline-renderer.ts';
import { createTimelineCompositor, type TimelineCompositingObserver } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import type { TimelineGroupLayer, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

/** 親背景から独立した画面を、同じScene時刻で合成する。独立した配置・時計は作らない。 */
export function createGroupTimelineLayer(getGroup: () => TimelineGroupLayer, options: {
	device: GPUDevice; vertex: GPUShaderModule; resolution: { width: number; height: number }; format: IntermediateTextureFormat;
	onCompositing?: TimelineCompositingObserver | null;
	createLayer: (layer: TimelineLayer, clipId: string | null) => TimelineLayerRenderer<TimelineImage>;
	getLayerVersion: (layer: TimelineLayer, clipId: string | null) => string | number;
}): TimelineLayerRenderer<TimelineImage> {
	const renderer = new TimelineRenderer<TimelineImage, TimelineLayer>({
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
		createLayer: options.createLayer,
		getLayerVersion: options.getLayerVersion,
	});
	const compositor = createTimelineCompositor(options);
	const parameters = new TimelineCompositingParameters();
	return {
		createChildren(context, evaluation) {
			const group = getGroup();
			const settings = parameters.evaluate({
				time: context.sceneTimeMs,
				isExport: context.isExport,
				coordinateSpace: group.coordinateSpace,
				mask: group.mask,
				layerMask: group.layerMask,
				paramValues: group.compositingParamValues,
				automationGraphs: group.automationGraphs,
			});
			return renderer.createEvaluation(group.layers.filter(isTimelineRenderLayer), {
				...evaluation,
				time: context.sceneTimeMs,
				timeDelta: context.timeDelta,
				referenceTime: context.referenceTime != null ? { timeMs: context.referenceTime.sceneTimeMs, timeDelta: context.referenceTime.timeDelta } : undefined,
				renderSpace: getTimelineGroupSpace({ settings, compositingMode: group.compositingMode }, options.resolution, context.renderSpace),
				getInput: async () => ({ kind: 'uniform', value: [0, 0, 0, 0] }),
			});
		},
		async evaluate(context, signal) {
			const group = getGroup();
			const settings = parameters.evaluate({
				time: context.sceneTimeMs,
				isExport: context.isExport,
				coordinateSpace: group.coordinateSpace,
				mask: group.mask,
				layerMask: group.layerMask,
				paramValues: group.compositingParamValues,
				automationGraphs: group.automationGraphs,
			});
			const preserveDepth = group.compositingMode === 'preserveDepth';
			const result = await context.childEvaluation!.evaluate();
			if (signal.aborted) return { gpuTime: 0 };
			// 空白区間と、有効な子が返す透明画像は異なる。後者ではreplaceも実行する。
			if (!result.hasOutput) return { gpuTime: 0 };
			// 子のGPU時間は共有セッションが集計する。投影も子へ適用済みなので重ねない。
			return compositor.evaluate(context, result.output, settings, preserveDepth);
		},
		destroy() { renderer.clear(); compositor.dispose(); },
	};
}
