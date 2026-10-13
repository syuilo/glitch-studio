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
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] }, createLayer: options.createLayer, getLayerVersion: options.getLayerVersion,
	});
	const compositor = createTimelineCompositor(options);
	const parameters = new TimelineCompositingParameters();
	return {
		async evaluate(context, signal) {
			const group = getGroup();
			const settings = parameters.evaluate({
				time: context.sceneTimeMs, isExport: context.isExport,
				coordinateSpace: group.coordinateSpace, paramValues: group.compositingParamValues, automationGraphs: group.automationGraphs });
			const preserveDepth = group.compositingMode === 'preserveDepth';
			const childSpace = getTimelineGroupSpace({ settings, compositingMode: group.compositingMode }, options.resolution, context.renderSpace);
			// 親が固定した評価時刻を配下にも使い、子自身の無効化用には元の基準時刻を保持する。
			const referenceTime = context.referenceTime && { timeMs: context.referenceTime.sceneTimeMs, timeDelta: context.referenceTime.timeDelta };
			const result = await renderer.evaluateAt(context.sceneTimeMs, group.layers.filter(isTimelineRenderLayer), context.timeDelta, context.isExport, signal, referenceTime, childSpace);
			if (!result || signal.aborted) return { gpuTime: 0 };
			// 空白区間と、有効な子が返す透明画像は異なる。後者ではreplaceも実行する。
			if (!result.hasOutput) return { gpuTime: result.gpuTime };
			const encoder = options.device.createCommandEncoder();
			try {
				// 奥行き維持では親変形・カメラは各子へ適用済み。ここでは合成だけを一度行う。
				return { output: compositor.render(encoder, context.input, result.output, settings, context.renderSpace, preserveDepth), gpuTime: result.gpuTime };
			} finally { options.device.queue.submit([encoder.finish()]); }
		},
		destroy() { renderer.clear(); compositor.dispose(); },
	};
}
