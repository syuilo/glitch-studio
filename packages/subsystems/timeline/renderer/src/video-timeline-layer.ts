import { openVideoSource } from '@gs/shared/media/video-source.ts';
import { createVideoTexture } from '@gs/shared/media/video-texture.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { TimelineCompositingParameters } from './timeline-compositing-parameters.ts';
import type { TimelineVideoLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';

export function createVideoTimelineLayer(layer: TimelineVideoLayer, blob: Blob, options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: { width: number; height: number };
	resolutionScale: number;
	format: IntermediateTextureFormat;
}): TimelineLayerRenderer<UniformOrTexture> {
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
				const sample = await source.getSample(context.contentTimeMs / 1000);
				try {
					if (disposed || signal.aborted) return { gpuTime: 0 };
					// replaceの無変形時はcompositorが素材を直接返すため、合成前に原寸へ倍率を
					// 一度だけ適用する。後続モジュールの自動解像度は、この計算用寸法を継承する。
					const foreground: UniformOrTexture = sample ? { kind: 'texture', texture: texture.upload(sample, options.resolutionScale) }
						: { kind: 'uniform', value: [0, 0, 0, 0] };
					const encoder = options.device.createCommandEncoder();
					try {
						const settings = parameters.evaluate({ time: context.sceneTimeMs, isExport: context.isExport, paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs });
						return { output: compositor.render(encoder, context.input, foreground, settings), gpuTime: 0 };
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
