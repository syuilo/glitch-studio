import { scaleResolution } from '@glitch/shared/resolution.ts';
import { createShaderInputPipeline } from '@glitch/shared/shader-input-pipeline.ts';
import type { TimelineImageLayer } from '@glitch/shared/timeline/types.ts';
import type { IntermediateTextureFormat } from '@glitch/shared/types.ts';
import type { NodeOutput } from './node-output.ts';
import type { TimelineLayerRenderer } from './timeline-renderer.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { TimelineCompositingParameters } from './timeline-compositing-parameters.ts';

export function createImageTimelineLayer(layer: TimelineImageLayer, sourceTexture: GPUTexture, options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: { width: number; height: number };
	resolutionScale: number;
	format: IntermediateTextureFormat;
}): TimelineLayerRenderer<NodeOutput> {
	const compositor = createTimelineCompositor(options);
	const parameters = new TimelineCompositingParameters();
	const sourceResolution = scaleResolution(sourceTexture, options.resolutionScale);
	let scaledTexture: GPUTexture | undefined;
	let scalingPipeline: ReturnType<typeof createShaderInputPipeline> | undefined;
	let disposed = false;
	return {
		async evaluate(context, signal) {
			if (disposed || signal.aborted) return { gpuTime: 0 };
			const settings = parameters.evaluate({ time: context.sceneTimeMs, isExport: context.isExport, paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs });
			const encoder = options.device.createCommandEncoder();
			try {
				// replaceの無変形経路は素材を直接後段へ渡す。原寸のままだと後続モジュールの
				// 自動解像度だけがプレビュー倍率を無視するため、素材にも倍率を一度だけ適用する。
				// 静止画像は再描画のたびに縮小せず、Asset変更・倍率変更でレイヤーが破棄されるまで再利用する。
				if (!scaledTexture && (sourceResolution.width !== sourceTexture.width || sourceResolution.height !== sourceTexture.height)) {
					scaledTexture = options.device.createTexture({ size: sourceResolution, format: options.format,
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
					scalingPipeline = createShaderInputPipeline({
						device: options.device, vertex: options.vertex, schema: { source: 'color' }, targets: [{ format: options.format }],
						code: '@fragment fn fs(@location(0) position: vec2f) -> @location(0) vec4f { return read_source(position); }',
					});
					// Asset側で既にpremultiply済みなので、RGBAをそのまま補間する。
					const variant = scalingPipeline.update({ source: { kind: 'texture', texture: sourceTexture,
						fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' } }, sourceResolution);
					const pass = encoder.beginRenderPass({ colorAttachments: [{ view: scaledTexture.createView(),
						loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
					pass.setPipeline(variant.pipeline);
					pass.setBindGroup(scalingPipeline.inputGroup, variant.bindGroup);
					pass.draw(6);
					pass.end();
				}
				const foreground: NodeOutput = { kind: 'texture', texture: scaledTexture ?? sourceTexture };
				return { output: compositor.render(encoder, context.input, foreground, settings), gpuTime: 0 };
			} finally { options.device.queue.submit([encoder.finish()]); }
		},
		destroy() {
			disposed = true;
			// sourceTextureはAssetTexturesから借用しており、他のレイヤーやノードも参照する。
			scaledTexture?.destroy();
			scalingPipeline?.dispose();
			compositor.dispose();
		},
	};
}
