import shader from './audio-plot.wgsl?raw';
import type { EffectInstance } from '../effect-implementation.ts';

export function createAudioPlot(device: GPUDevice, vertex: GPUShaderModule, columns: number, format: GPUTextureFormat) {
	const module = device.createShaderModule({ code: shader });
	const pipeline = device.createRenderPipeline({
		layout: 'auto', vertex: { module: vertex },
		fragment: { module, targets: [{ format }] },
		primitive: { topology: 'triangle-list' },
	});
	const uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const dataBuffer = device.createBuffer({ size: columns * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	const data = new Float32Array(columns * 4);
	const uniforms = new Float32Array(16);
	const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
		{ binding: 0, resource: { buffer: uniformBuffer } },
		{ binding: 1, resource: { buffer: dataBuffer } },
	] });
	return {
		data,
		render(ctx: Parameters<EffectInstance['render']>[0], options: {
			color: readonly number[]; rightColor: readonly number[]; stereo: boolean;
			spectrum: boolean; lineWidth: number; aspectRatio: number; valid: boolean;
		}) {
			uniforms.set([options.color[0], options.color[1], options.color[2], 1,
																	options.rightColor[0], options.rightColor[1], options.rightColor[2], 1,
																	columns, Number(options.stereo), Number(options.spectrum), options.lineWidth,
																	options.aspectRatio, Number(options.valid), 0, 0]);
			device.queue.writeBuffer(uniformBuffer, 0, uniforms);
			device.queue.writeBuffer(dataBuffer, 0, data);
			const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup);
			pass.draw(6);
			pass.end();
		},
		dispose() { uniformBuffer.destroy(); dataBuffer.destroy(); },
	};
}
