import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

/** Scene全体のpremultiplied RGBAを同じ重みで平均する。通常の画像保存精度とは独立。 */
export function createMotionBlurAccumulator(options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: Resolution;
	enable32bitDataTextures: boolean;
}) {
	const { device, resolution } = options;
	const format = options.enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
	const textures = Array.from({ length: 2 }, () => device.createTexture({
		size: resolution, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
	}));
	const views = textures.map(texture => texture.createView());
	const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const layout = device.createBindGroupLayout({ entries: [
		{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
	] });
	const groups = views.map(view => device.createBindGroup({ layout, entries: [
		{ binding: 0, resource: view }, { binding: 1, resource: { buffer: uniforms } },
	] }));
	const pipeline = createShaderInputPipeline({
		device, vertex: options.vertex, schema: { sample: 'color' }, internalLayouts: [layout], targets: [{ format }],
		code: `
@group(0) @binding(0) var previous: texture_2d<f32>;
@group(0) @binding(1) var<uniform> weight: f32;
@fragment fn fs(@location(0) position: vec2f, @builtin(position) pixel: vec4f) -> @location(0) vec4f {
	let sample = read_sample(position);
	// 初回は前の出力フレームを読まず、新しい平均の蓄積を開始する。
	if (weight == 1.0) { return sample; }
	// 蓄積バッファは同じ画素の値を厳密に読む。補間すると各サンプルで画像がぼけてしまう。
	let mean = textureLoad(previous, vec2i(pixel.xy), 0);
	// 総和を保存しない逐次平均により、サンプル数に比例するfloat16の範囲超過を避ける。
	return mix(mean, sample, weight);
}`,
	});
	return {
		add(encoder: GPUCommandEncoder, output: UniformOrTexture, index: number): UniformOrTexture {
			const target = index % 2;
			device.queue.writeBuffer(uniforms, 0, new Float32Array([1 / (index + 1)]));
			// 定数出力も直接読み、Sceneの画面全体へ展開する。入力のRGBは再乗算しない。
			const variant = pipeline.update({ sample: toShaderInput(output, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }) }, resolution);
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: views[target], loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
			pass.setPipeline(variant.pipeline);
			pass.setBindGroup(0, groups[1 - target]);
			pass.setBindGroup(pipeline.inputGroup, variant.bindGroup);
			pass.draw(6);
			pass.end();
			return { kind: 'texture', texture: textures[target] };
		},
		dispose() {
			pipeline.dispose();
			uniforms.destroy();
			for (const texture of textures) texture.destroy();
		},
	};
}
