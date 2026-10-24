import { prepareColorRamp } from '@gs/shared/color-ramp.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const settings = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		let capacity = 48;
		let stops = device.createBuffer({ size: capacity, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const createBindGroup = () => device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: settings } }, { binding: 1, resource: { buffer: stops } }] });
		let bindGroup = createBindGroup();
		let previousRamp: string | null = null;
		const pipelines = createShaderInputPipeline({ device, vertex: wgpu.defaultVertexShaderModule, code, schema: { input: 'scalar' }, targets: [{ format: wgpu.intermediateTextureFormat }], internalLayouts: [layout] });
		return {
			render: ctx => {
				const rampKey = JSON.stringify(ctx.params.ramp);
				if (rampKey !== previousRamp) {
					const ramp = prepareColorRamp(ctx.params.ramp);
					const required = ramp.stops.length * 48;
					if (required > device.limits.maxStorageBufferBindingSize || required > device.limits.maxBufferSize) throw new Error('Color Ramp exceeds GPU buffer limits');
					if (required > capacity) {
						// stop数の変更ではシェーダーを再コンパイルせず、容量不足のときだけbufferを交換する。
						const replacement = device.createBuffer({ size: required, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
						stops.destroy();
						stops = replacement;
						capacity = required;
						bindGroup = createBindGroup();
					}
					// positionは16byte、補間用の色と端点用のsRGBはそれぞれvec4fで48byte/stop。
					// 端点とConstantでは変換を往復せず、設定した色をそのまま保つ。
					const values = new Float32Array(required / 4);
					for (const [index, stop] of ramp.stops.entries()) {
						values[index * 12] = stop.position;
						values.set(stop.color, index * 12 + 4);
						values.set(stop.srgbColor, index * 12 + 8);
					}
					device.queue.writeBuffer(stops, 0, values);
					device.queue.writeBuffer(settings, 0, new Uint32Array([ramp.stops.length, ['constant', 'linear', 'smoothstep'].indexOf(ramp.interpolation), ['srgb', 'linearSrgb', 'oklab'].indexOf(ramp.colorSpace), 0]));
					previousRamp = rampKey;
				}
				const variant = pipelines.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); settings.destroy(); stops.destroy(); },
		};
	},
});
