import { openVideoSource } from '@glitch/shared/media/video-source.ts';
import { createVideoTexture } from '@glitch/shared/media/video-texture.ts';
import type { TimelineVideoLayer } from '@glitch/shared/timeline/types.ts';
import type { IntermediateTextureFormat } from '@glitch/shared/types.ts';
import type { NodeOutput } from './node-output.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { TimelineCompositingParameters } from './timeline-compositing-parameters.ts';

export function createVideoTimelineLayer(layer: TimelineVideoLayer, blob: Blob, options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: { width: number; height: number };
	format: IntermediateTextureFormat;
}): TimelineLayerRenderer<NodeOutput> {
	const source = openVideoSource(blob);
	const texture = createVideoTexture(options.device, options.format);
	const compositor = createTimelineCompositor(options);
	const parameters = new TimelineCompositingParameters();
	let disposed = false;
	let pending: Promise<unknown> = Promise.resolve();
	return {
		evaluate(context, signal) {
			// 同じ配置の連続シークはデコーダーを直列に使う。待機中に不要になった要求は
			// デコードせず、完了が遅れた旧フレームも新しいテクスチャへ書き込まない。
			const render = async () => {
				if (disposed || signal.aborted) return { gpuTime: 0 };
				const sample = await source.getSample(context.time / 1000);
				try {
					if (disposed || signal.aborted) return { gpuTime: 0 };
					const foreground: NodeOutput = sample ? { kind: 'texture', texture: texture.upload(sample) }
						: { kind: 'uniform', value: [0, 0, 0, 0] };
					const encoder = options.device.createCommandEncoder();
					try {
						const settings = parameters.evaluate({ ...context, paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs });
						return { output: compositor.render(encoder, context.input, foreground, settings, layer.fitMode), gpuTime: 0 };
					} finally { options.device.queue.submit([encoder.finish()]); }
				} finally { sample?.close(); }
			};
			const result = pending.then(render);
			pending = result.catch(() => {});
			return result;
		},
		destroy() {
			disposed = true;
			source.dispose();
			texture.dispose();
			compositor.dispose();
		},
	};
}
