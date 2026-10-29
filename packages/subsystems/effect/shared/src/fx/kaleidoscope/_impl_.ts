import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { input: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// 中心と折り目では角度の微分が不安定になるため、LOD 0で参照する。
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const output = ctx.outputDataMap.output.texture;
				uniformValues.set({
					center: ctx.params.center,
					sourceCenter: ctx.params.sourceCenter,
					aspectRatio: output.width / output.height,
					// 式やキーから小数が渡っても全周が閉じるよう、1以上の整数にする。
					sectorAngle: 2 * Math.PI / Math.max(1, Math.round(ctx.params.repetitions)),
					mirror: ctx.params.mirror ? 1 : 0,
					angularSkew: Math.max(-1, Math.min(1, ctx.params.angularSkew)),
					rotation: ctx.params.rotation * (2 * Math.PI),
					twist: ctx.params.twist * (2 * Math.PI),
					radialRepeat: Math.max(0, ctx.params.radialRepeat),
					// 大きな位相をGPUへ渡して半径方向の細かな差が失われないよう、周期内へ戻す。
					radialPhase: ctx.params.radialPhase - Math.floor(ctx.params.radialPhase),
					sourceRotation: ctx.params.sourceRotation * (2 * Math.PI),
					// Zoomは正の拡大率。UI範囲外の値でもゼロ除算を起こさない。
					zoom: Math.max(0.000001, ctx.params.zoom),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: ctx.params.input }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
