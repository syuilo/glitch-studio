import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import definition from './_def_.ts';
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
				inputs: { array: 'color' },
				perCellSelection: 'scalar',
				perCellOpacity: 'scalar',
				perCellTranslation: 'vector',
				perCellScale: 'vector',
				perCellRotation: 'scalar',
			},
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// セル境界・素材の選択・切り取りで参照先が不連続になるため、微分不要の明示LODで読む。
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const { inputs, frequency, phase, angle, sizeReference, controlSamples, perCellSelection, perCellOpacity, perCellTranslation, translationUnit, perCellScale, perCellRotation } = ctx.params;
				if (inputs.length > definition.paramDefs.inputs.maxElements) throw new Error('Cell Repeater supports at most 10 inputs');
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const shortDimension = Math.min(width, height);
				const referenceExtent = getSizeReferenceLength(sizeReference, output.texture);
				// Grid系と同じ基準領域を使う。1周期は1セルで、1未満のFrequencyも許可する。
				const cellWidth = referenceExtent / (Number.isFinite(frequency[0]) ? Math.max(0.01, frequency[0]) : 0.01);
				const cellHeight = referenceExtent / (Number.isFinite(frequency[1]) ? Math.max(0.01, frequency[1]) : 0.01);
				const aspect = [width / shortDimension, height / shortDimension] as const;
				const cellSize = [cellWidth / shortDimension, cellHeight / shortDimension] as const;
				uniformValues.set({
					aspect,
					cellSize,
					translationUnitScale: translationUnit === 'screen' ? [aspect[0] * 0.5, aspect[1] * 0.5] : cellSize,
					phase: phase.map(value => Number.isFinite(value) ? value : 0),
					angle: Number.isFinite(angle) ? angle * 2 * Math.PI : 0,
					controlSamples: Number.isFinite(controlSamples) ? Math.min(256, Math.max(1, Math.round(controlSamples))) : 1,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({
					inputs, perCellSelection, perCellOpacity, perCellTranslation, perCellScale, perCellRotation,
				}, output.texture, {
					// 素材は変形前のセル、制御用の場は出力画面を基準にfitする。
					// 基準を分けないと、長方形セルへ素材を入れた際に縦横比が崩れる。
					inputs: { width: cellWidth, height: cellHeight },
				});
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
