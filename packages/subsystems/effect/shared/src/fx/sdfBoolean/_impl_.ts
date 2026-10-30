import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import shapeDistanceCode from '@gs/shared/gpu/shape-distance.wgsl?raw';
import { implementEffect } from '../../effect-implementation.ts';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = shapeDistanceCode + '\n' + shaderCode;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const { device } = wgpu;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { inputA: 'scalar', inputB: 'scalar' }, sampling: 'level0', internalLayouts: [layout],
			targets: [{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' }],
			constants: { MAX_OUTPUT_DISTANCE: wgpu.enable32bitDataTextures ? 3.4028234663852886e38 : 65504 },
		});
		return {
			render: ctx => {
				const { inputA, inputB } = ctx.params;
				const output = ctx.outputDataMap.output.texture;
				const transparentA = inputA.kind === 'texture' && inputA.wrapMode === 'transparent';
				const transparentB = inputB.kind === 'texture' && inputB.wrapMode === 'transparent';
				// SDFの0は背景でなく境界。透明入力の距離は端で延長して読み、
				// それぞれの入力領域の矩形との共通部分にすることで、領域外の距離も残す。
				const distanceInputA = transparentA ? { ...inputA, wrapMode: 'clamp' as const } : inputA;
				const distanceInputB = transparentB ? { ...inputB, wrapMode: 'clamp' as const } : inputB;
				uniformValues.set({
					inputScaleA: transparentA ? inputUvScale(inputA.texture, output, inputA.fitMode) : [1, 1],
					inputScaleB: transparentB ? inputUvScale(inputB.texture, output, inputB.fitMode) : [1, 1],
					transparentA: transparentA ? 1 : 0,
					transparentB: transparentB ? 1 : 0,
					aspectRatio: output.width / output.height,
					operation: { union: 0, intersection: 1, difference: 2 }[ctx.params.operation],
					smoothing: Math.max(0, Math.min(ctx.params.smoothing, 3.4028234663852886e38)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ inputA: distanceInputA, inputB: distanceInputB }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); uniformBuffer.destroy(); },
		};
	},
});
