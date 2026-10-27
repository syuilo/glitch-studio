import { getTimelineRenderLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineGroupSpace } from '@gs/subsystems_timeline_shared/group-space.ts';
import { TimelineRenderer, type TimelineLayerRenderer } from '../../timeline-renderer.ts';
import type { TimelineEvaluation } from '../../timeline-evaluation.ts';
import { createTimelineCompositor, type TimelineCompositingObserver } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import type { TimelineCompositingSettings } from '../../timeline-compositing-parameters.ts';
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
	// 設定と合成モードは、子の描画空間を作った評価に結び付ける。単一の「最新値」を
	// 持つと、別サンプルの準備が先に進んだ際に、待機中の評価へその値が混ざってしまう。
	// 呼び出し側がcontextをコピーしても同じ子評価を参照するため、そのオブジェクトをキーにする。
	const evaluationSettings = new WeakMap<TimelineEvaluation<TimelineImage>, { settings: TimelineCompositingSettings; preserveDepth: boolean }>();
	return {
		createChildren(context, evaluation) {
			const group = getGroup();
			const compositingMode = group.compositingMode ?? 'flat';
			const settings = parameters.evaluate({
				time: context.sceneTimeMs,
				isExport: context.isExport,
				coordinateSpace: group.coordinateSpace,
				mask: group.mask,
				layerMask: group.layerMask,
				paramValues: group.compositingParamValues,
				customParameters: context.customParameters,
				automationGraphs: group.automationGraphs,
			});
			const childEvaluation = renderer.createEvaluation(getTimelineRenderLayers(group.layers), {
				...evaluation,
				time: context.sceneTimeMs,
				timeDelta: context.timeDelta,
				referenceTime: context.referenceTime != null ? { timeMs: context.referenceTime.sceneTimeMs, timeDelta: context.referenceTime.timeDelta } : undefined,
				renderSpace: getTimelineGroupSpace({ settings, compositingMode }, options.resolution, context.renderSpace),
				getInput: async () => ({ kind: 'uniform', value: [0, 0, 0, 0] }),
			});
			evaluationSettings.set(childEvaluation, { settings, preserveDepth: compositingMode === 'preserveDepth' });
			return childEvaluation;
		},
		async evaluate(context, signal) {
			const childEvaluation = context.childEvaluation!;
			const { settings, preserveDepth } = evaluationSettings.get(childEvaluation)!;
			const result = await childEvaluation.evaluate();
			if (signal.aborted) return { gpuTime: 0 };
			// 空白区間と、有効な子が返す透明画像は異なる。後者ではreplaceも実行する。
			if (!result.hasOutput) return { gpuTime: 0 };
			// 子のGPU時間は共有セッションが集計する。投影も子へ適用済みなので重ねない。
			return compositor.evaluate(context, result.output, settings, preserveDepth);
		},
		destroy() { renderer.clear(); compositor.dispose(); },
	};
}
