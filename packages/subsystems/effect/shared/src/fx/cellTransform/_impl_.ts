import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { getCellSubdivisionLevels } from '../../cell-subdivision.ts';
import cellSubdivisionCode from '../../cell-subdivision.wgsl?raw';
import type definition from './_def_.ts';
import shaderCode from './shader.wgsl?raw';

const code = cellSubdivisionCode + '\n' + shaderCode;
const cellWrapModes = { transparent: 0, clamp: 1, repeat: 2, repeatMirrored: 3 };

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
		const inactiveDensityMap = constantShaderInput('scalar', 0);
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
				densityMap: 'scalar',
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
				const { input, frequency, phase, angle, sizeReference, controlSamples, perCellOpacity, perCellTranslation, translationUnit, perCellScale, perCellRotation } = ctx.params;
				const maxSubdivisionLevels = getCellSubdivisionLevels(ctx.params.subdivisionMode, ctx.params.maxSubdivisionLevels);
				// Uniform・深度0では密度のテクスチャ参照も四分木の探索も不要にする。
				const densityMap = maxSubdivisionLevels > 0 ? ctx.params.densityMap : inactiveDensityMap;
				const usesImageWrap = ctx.params.wrapReference === 'image';
				// Imageではセルの切り出し範囲を越えて画像全体を読むため、入力テクスチャの
				// samplerに選択したWrap Modeを渡す。Fit・Filterと透明境界の補間は共通処理を使う。
				// 借用した入力自体は変更せず、制御用の場のサンプリング設定も維持する。
				const sourceInput = usesImageWrap && input.kind === 'texture' ? { ...input, wrapMode: ctx.params.cellWrapMode } : input;
				const output = ctx.outputDataMap.output;
				const { width, height } = output.texture;
				const shortDimension = Math.min(width, height);
				const referenceExtent = getSizeReferenceLength(sizeReference, output.texture);
				// Grid系と同じくSize Referenceを基準に分割する。1周期は1セル。
				const cellWidth = referenceExtent / (Number.isFinite(frequency[0]) ? Math.max(0.01, frequency[0]) : 0.01);
				const cellHeight = referenceExtent / (Number.isFinite(frequency[1]) ? Math.max(0.01, frequency[1]) : 0.01);
				const aspect = [width / shortDimension, height / shortDimension] as const;
				const cellSize = [cellWidth / shortDimension, cellHeight / shortDimension] as const;
				uniformValues.set({
					aspect,
					cellSize,
					translationUnitScale: translationUnit === 'canvas' ? [Math.max(width, height) / shortDimension, Math.max(width, height) / shortDimension] : cellSize,
					phase: phase.map(value => Number.isFinite(value) ? value : 0),
					angle: Number.isFinite(angle) ? angle * 2 * Math.PI : 0,
					controlSamples: Number.isFinite(controlSamples) ? Math.min(256, Math.max(1, Math.round(controlSamples))) : 1,
					cellWrapMode: cellWrapModes[ctx.params.cellWrapMode],
					wrapReference: Number(usesImageWrap),
					imageInputIsConstant: Number(input.kind === 'uniform'),
					maxSubdivisionLevels,
					translationUsesCellUnits: Number(translationUnit === 'cell'),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 素材も制御用の場も出力画面を基準にfitする。素材をセルごとにfitし直すと
				// 元画像の切り出しではなく複製になってしまうため、全体の座標対応を維持する。
				const variant = pipelines.update({ input: sourceInput, densityMap, perCellOpacity, perCellTranslation, perCellScale, perCellRotation }, output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
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
