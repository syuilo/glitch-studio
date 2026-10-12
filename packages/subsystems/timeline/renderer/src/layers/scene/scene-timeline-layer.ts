import { TimelineSceneCamera } from '@gs/subsystems_timeline_shared/scene-camera.ts';
import { isTimelineRenderLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { TIMELINE_IDENTITY, TIMELINE_FRAME } from '@gs/subsystems_timeline_shared/spatial.ts';
import { TimelineRenderer } from '../../timeline-renderer.ts';
import { createTimelineCompositor } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import { createSceneOutput } from '../../scene-output.ts';
import type { TimelineLayer, TimelineScene, TimelineSceneLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { TimelineLayerRenderer } from '../../timeline-renderer.ts';
import type { TimelineCompositingObserver } from '../../timeline-compositor.ts';

/** 解決済みのSceneを独立して評価し、配置の合成設定を親背景に適用する。 */
export function createSceneTimelineLayer(
	sceneSource: TimelineScene | (() => TimelineScene),
	layer: TimelineSceneLayer,
	options: {
		device: GPUDevice;
		vertex: GPUShaderModule;
		resolution: { width: number; height: number };
		sceneResolution: { width: number; height: number };
		format: IntermediateTextureFormat;
		onCompositing?: TimelineCompositingObserver;
		createLayer: (entry: TimelineLayer, clipId: string | null) => TimelineLayerRenderer<TimelineImage>;
		getLayerVersion?: (entry: TimelineLayer, clipId: string | null) => string | number;
	},
): TimelineLayerRenderer<TimelineImage> {
	// 定義が同じでも履歴・出力の所有者は配置ごとに分ける。親背景は子に渡さない。
	const camera = new TimelineSceneCamera();
	const renderer = new TimelineRenderer<TimelineImage, TimelineLayer>({
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
		createLayer: options.createLayer,
		getLayerVersion: options.getLayerVersion,
	});
	const compositor = createTimelineCompositor({
		device: options.device, vertex: options.vertex, resolution: options.resolution, format: options.format, onCompositing: options.onCompositing,
	});
	const parameters = new TimelineCompositingParameters();
	const sceneOutput = createSceneOutput({ ...options, resolution: options.sceneResolution });
	return {
		evaluate: async (context, signal) => {
			const scene = typeof sceneSource === 'function' ? sceneSource() : sceneSource;
			// 参照先Sceneの時計へ両方の時刻を変換する。配置ごとの無効化は保存された子の設定を変更しない。
			const referenceTime = context.referenceTime && { timeMs: context.referenceTime.contentTimeMs, timeDelta: context.referenceTime.timeDelta };
			const result = await renderer.evaluateAt(context.contentTimeMs, scene.layers.filter(isTimelineRenderLayer), context.timeDelta, context.isExport, signal, referenceTime,
				{ parent: TIMELINE_IDENTITY, depth: 0, viewport: TIMELINE_FRAME, camera: camera.evaluate(scene.layers, context.contentTimeMs, context.isExport, referenceTime?.timeMs) });
			if (result == null || signal.aborted) return { gpuTime: 0 };
			const encoder = options.device.createCommandEncoder();
			try {
				const settings = parameters.evaluate({
					time: context.sceneTimeMs, isExport: context.isExport,
					coordinateSpace: layer.coordinateSpace, paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs });
				const source: TimelineImage = { kind: 'texture', texture: sceneOutput.render(encoder, result.output) };
				return { output: compositor.render(encoder, context.input, source, settings, context.renderSpace), gpuTime: result.gpuTime };
			} finally {
				options.device.queue.submit([encoder.finish()]);
			}
		},
		destroy: () => {
			renderer.clear();
			compositor.dispose();
			sceneOutput.dispose();
		},
	};
}
