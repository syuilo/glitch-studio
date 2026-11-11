import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { IMAGE_TRAP_SPAN_AT_ZOOM_ONE, IMAGE_TRAP_MINIMUM_ZOOM } from './_def_.ts';
import type definition from './_def_.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', coordinateOffset: 'vector' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
			// 画素ごとに軌道・終了反復・画像を読む回数が異なるため、implicit derivativeは使わない。
			sampling: 'level0',
		});
		const spatialHalfExtent = getSpatialHalfExtent(resolution);
		return {
			render: ctx => {
				const params = ctx.params;
				const rotation = params.view.rotation * 2 * Math.PI;
				const trapRotation = params.trapRotation * 2 * Math.PI;
				const trapSize = params.trapSize.map(value => Math.max(0.000001, value));
				uniformValues.set({
					spatialHalfExtent,
					pixelStep: [2 / resolution.width, 2 / resolution.height],
					complexCenter: params.view.center,
					juliaConstant: params.juliaConstant,
					rotation: [Math.cos(rotation), Math.sin(rotation)],
					trapRotation: [Math.cos(trapRotation), Math.sin(trapRotation)],
					trapPosition: params.trapPosition,
					trapSize,
					complexScale: IMAGE_TRAP_SPAN_AT_ZOOM_ONE / Math.max(IMAGE_TRAP_MINIMUM_ZOOM, params.view.zoom),
					bailoutRadius: Math.min(1e12, Math.max(2, params.bailoutRadius)),
					opacity: Math.min(1, Math.max(0, params.opacity)),
					iterationDecay: Math.min(1, Math.max(0, params.iterationDecay)),
					firstIteration: Math.min(512, Math.max(1, Math.floor(params.firstIteration))),
					maximumIterations: Math.min(512, Math.max(1, Math.floor(params.maximumIterations))),
					formula: params.formula === 'julia' ? 0 : 1,
					compositeMode: ['firstOnTop', 'lastOnTop', 'maximumAlpha'].indexOf(params.compositeMode),
					antialiasing: params.antialiasing ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({ input: params.input, coordinateOffset: params.coordinateOffset }, resolution, {
					// 素材のfitは出力画面ではなくトラップの矩形へ適用する。縦横比の異なる
					// 出力へ切り替えても、同じTrap Sizeなら同じ形・比率で画像を取り込める。
					input: { width: trapSize[0], height: trapSize[1] },
				});
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
