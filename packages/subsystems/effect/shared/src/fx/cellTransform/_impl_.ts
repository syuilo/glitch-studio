import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import type definition from './_def_.ts';
import code from './shader.wgsl?raw';

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
			schema: {
				input: 'color',
				perCellOpacity: 'scalar',
				perCellTranslation: 'vector',
				perCellScale: 'vector',
				perCellRotation: 'scalar',
			},
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// セルごとの変形と切り取りで参照位置が不連続になるため、微分不要の明示LODで読む。
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const { input, frequency, phase, angle, fitMode, controlSamples, perCellOpacity, perCellTranslation, perCellScale, perCellRotation } = ctx.params;
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const shortDimension = Math.min(width, height);
				const referenceExtent = fitMode === 'cover' ? Math.max(width, height) : shortDimension;
				// Grid系と同じく各軸／長辺／短辺を基準に分割する。1周期は1セル。
				const cellWidth = (fitMode === 'stretch' ? width : referenceExtent) / (Number.isFinite(frequency[0]) ? Math.max(0.01, frequency[0]) : 0.01);
				const cellHeight = (fitMode === 'stretch' ? height : referenceExtent) / (Number.isFinite(frequency[1]) ? Math.max(0.01, frequency[1]) : 0.01);
				uniformValues.set({
					aspect: [width / shortDimension, height / shortDimension],
					cellSize: [cellWidth / shortDimension, cellHeight / shortDimension],
					phase: phase.map(value => Number.isFinite(value) ? value : 0),
					angle: Number.isFinite(angle) ? angle * 2 * Math.PI : 0,
					controlSamples: Number.isFinite(controlSamples) ? Math.min(256, Math.max(1, Math.round(controlSamples))) : 1,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 素材も制御用の場も出力画面を基準にfitする。素材をセルごとにfitし直すと
				// 元画像の切り出しではなく複製になってしまうため、全体の座標対応を維持する。
				const variant = pipelines.update({ input, perCellOpacity, perCellTranslation, perCellScale, perCellRotation }, output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
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
