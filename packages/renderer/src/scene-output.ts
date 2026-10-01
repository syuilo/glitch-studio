import { createShaderInputPipeline } from '@glitch/shared/shader-input-pipeline.ts';
import type { Resolution } from '@glitch/shared/resolution.ts';
import type { IntermediateTextureFormat } from '@glitch/shared/types.ts';
import { outputShaderInput, type NodeOutput } from './node-output.ts';

/** Sceneの画面を確定する。親でのfitやoriginは、この透明余白を含む画面全体を基準とする。 */
export function createSceneOutput(options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: Resolution;
	format: IntermediateTextureFormat;
}) {
	let texture: GPUTexture | undefined;
	let pipeline: ReturnType<typeof createShaderInputPipeline> | undefined;
	return {
		render(encoder: GPUCommandEncoder, output: NodeOutput): GPUTexture {
			const { resolution } = options;
			if (output.kind === 'texture' && output.texture.width === resolution.width && output.texture.height === resolution.height) return output.texture;
			texture ??= options.device.createTexture({ size: resolution, format: options.format,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			pipeline ??= createShaderInputPipeline({
				device: options.device, vertex: options.vertex, schema: { source: 'color' }, targets: [{ format: options.format }],
				code: '@fragment fn fs(@location(0) position: vec2f) -> @location(0) vec4f { return read_source(position); }',
			});
			// 各レイヤーのfitは合成済み。replaceの省略経路も画面と同じ縦横比に限られるため、
			// ここでは再度fitせず画面全体を転写する。定数もSceneの寸法を持つ素材にする。
			// 入力はpremultiply済みなので、RGBAをそのまま補間して二重乗算を避ける。
			const variant = pipeline.update({ source: outputShaderInput(output, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }) }, resolution);
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
			pass.setPipeline(variant.pipeline);
			pass.setBindGroup(pipeline.inputGroup, variant.bindGroup);
			pass.draw(6);
			pass.end();
			return texture;
		},
		dispose() {
			// 既に指定寸法だった借用テクスチャは破棄しない。
			texture?.destroy();
			pipeline?.dispose();
		},
	};
}
