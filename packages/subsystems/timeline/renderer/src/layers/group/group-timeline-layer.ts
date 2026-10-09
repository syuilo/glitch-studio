import type { TimelineGroupLayer, TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import { TimelineRenderer, type TimelineLayerRenderer } from '../../timeline-renderer.ts';
import { createTimelineCompositor, type TimelineCompositingObserver } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import { createSceneOutput } from '../../scene-output.ts';

/** 親背景から独立した画面を、同じScene時刻で合成する。独立した配置・時計は作らない。 */
export function createGroupTimelineLayer(getGroup: () => TimelineGroupLayer, options: {
	device: GPUDevice; vertex: GPUShaderModule; resolution: { width: number; height: number }; format: IntermediateTextureFormat;
	onCompositing?: TimelineCompositingObserver;
	createLayer: (layer: TimelineLayer, clipId: string | null) => TimelineLayerRenderer<UniformOrTexture>;
	getLayerVersion: (layer: TimelineLayer, clipId: string | null) => string | number;
}): TimelineLayerRenderer<UniformOrTexture> {
	const renderer = new TimelineRenderer<UniformOrTexture, TimelineLayer>({
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] }, createLayer: options.createLayer, getLayerVersion: options.getLayerVersion,
	});
	const compositor = createTimelineCompositor(options);
	const screen = createSceneOutput(options);
	const parameters = new TimelineCompositingParameters();
	return {
		async evaluate(context, signal) {
			const group = getGroup();
			const result = await renderer.evaluateAt(context.sceneTimeMs, group.layers.filter(layer => layer.layerType !== 'audio'), context.timeDelta, context.isExport, signal);
			if (!result || signal.aborted) return { gpuTime: 0 };
			// 空白区間と、有効な子が返す透明画像は異なる。後者ではreplaceも実行する。
			if (!result.hasOutput) return { gpuTime: result.gpuTime };
			const encoder = options.device.createCommandEncoder();
			try {
				const settings = parameters.evaluate({ time: context.sceneTimeMs, isExport: context.isExport,
					paramValues: group.compositingParamValues, automationGraphs: group.automationGraphs });
				return { output: compositor.render(encoder, context.input, { kind: 'texture', texture: screen.render(encoder, result.output) }, settings), gpuTime: result.gpuTime };
			} finally { options.device.queue.submit([encoder.finish()]); }
		},
		destroy() { renderer.clear(); compositor.dispose(); screen.dispose(); },
	};
}
