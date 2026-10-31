import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code: colorRamp.shaderCode + '\n' + code,
			schema: { vector: 'vector' }, targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout, colorRamp.layout],
			// セル中心への量子化と、画素ごとに異なるセルの参照はimplicit LODの微分に依存させない。
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const output = ctx.outputDataMap.output.texture;
				const shortDimension = Math.min(output.width, output.height);
				uniformValues.set({
					aspect: [output.width / shortDimension, output.height / shortDimension],
					cellSize: getSizeReferenceLength(ctx.params.sizeReference, output) / shortDimension / Math.max(1, ctx.params.density),
					maximumMagnitude: Math.max(0.000001, ctx.params.maximumMagnitude),
					lineWidth: Math.min(0.5, Math.max(0, ctx.params.lineWidth)),
					directionSpace: ctx.params.directionSpace === 'displacement' ? 1 : 0,
					gridWidth: Math.min(0.5, Math.max(0, ctx.params.gridWidth)),
					zeroColor: ctx.params.zeroColor,
					overflowColor: ctx.params.overflowColor,
					gridColor: ctx.params.gridColor,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampBindGroup = colorRamp.update(ctx.params.ramp);
				const variant = pipelines.update({ vector: ctx.params.vector }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(1, rampBindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); colorRamp.dispose(); uniformBuffer.destroy(); },
		};
	},
});
