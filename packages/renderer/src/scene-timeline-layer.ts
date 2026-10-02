import type { TimelineLayer, TimelineScene, TimelineSceneLayer } from '@glitch/shared/timeline/types.ts';
import type { IntermediateTextureFormat } from '@glitch/shared/types.ts';
import type { NodeOutput } from './node-output.ts';
import { TimelineRenderer } from './timeline-renderer.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { TimelineCompositingParameters } from './timeline-compositing-parameters.ts';
import { createSceneOutput } from './scene-output.ts';

/** 解決済みのSceneを独立して評価し、配置の合成設定を親背景に適用する。 */
export function createSceneTimelineLayer(
	scene: TimelineScene,
	layer: TimelineSceneLayer,
	options: {
		device: GPUDevice;
		vertex: GPUShaderModule;
		resolution: { width: number; height: number };
		sceneResolution: { width: number; height: number };
		format: IntermediateTextureFormat;
		createLayer: (entry: TimelineLayer, clipId: string) => TimelineLayerRenderer<NodeOutput>;
	},
): TimelineLayerRenderer<NodeOutput> {
	// 定義が同じでも履歴・出力の所有者は配置ごとに分ける。親背景は子に渡さない。
	const renderer = new TimelineRenderer<NodeOutput, TimelineLayer>({
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
		createLayer: options.createLayer,
	});
	const compositor = createTimelineCompositor({
		device: options.device, vertex: options.vertex, resolution: options.resolution, format: options.format,
	});
	const parameters = new TimelineCompositingParameters();
	const sceneOutput = createSceneOutput({ ...options, resolution: options.sceneResolution });
	return {
		evaluate: async (context, signal) => {
			const result = await renderer.evaluateAt(context.contentTimeMs, scene.layers.filter(entry => entry.layerType !== 'audio'), context.timeDelta, context.isExport, signal);
			if (result == null || signal.aborted) return { gpuTime: 0 };
			const encoder = options.device.createCommandEncoder();
			try {
				const settings = parameters.evaluate({ time: context.sceneTimeMs, isExport: context.isExport,
					paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs });
				const source: NodeOutput = { kind: 'texture', texture: sceneOutput.render(encoder, result.output) };
				return { output: compositor.render(encoder, context.input, source, settings), gpuTime: result.gpuTime };
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
