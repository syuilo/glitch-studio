import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createGlyphAtlas } from './glyph-atlas.ts';
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
	init: ({ wgpu, params, reportStatus }) => {
		const device = wgpu.device;
		const atlas = createGlyphAtlas(device, reportStatus);
		const uniforms = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniforms.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const bindGroup = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: atlas.texture.createView() },
			{ binding: 2, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) },
		] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			internalLayouts: [layout],
			// セル探索やラベル描画は画素ごとに分岐するため、入力のLODを明示する。
			sampling: 'level0',
		});
		const prepare = (values: typeof params) => atlas.prepare(values.fontFamily, values.fontWeight, values.labelMode !== 'none');
		const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
		prepare(params);
		return {
			get cacheVersion() { return atlas.cacheVersion; },
			prepare,
			render: ctx => {
				const values = ctx.params;
				prepare(values);
				const output = ctx.outputDataMap.output;
				uniforms.set({
					resolution: [output.texture.width, output.texture.height],
					threshold: Math.min(1, Math.max(0, finite(values.threshold, 0.25))),
					cellSize: Math.max(0, finite(values.cellSize, 400)),
					detectionMode: { alpha: 0, bright: 1, dark: 2, red: 3, green: 4, blue: 5 }[values.detectionMode],
					partitionLayout: { grid: 0, quadtree: 1, mosaic: 2 }[values.layout],
					// 式でUIの範囲を超えても、GPUでの探索回数は元実装と同じ上限に留める。
					maxDepth: Math.min(5, Math.max(0, Math.round(finite(values.maxDepth, 2)))),
					boxStyle: values.boxStyle === 'corners' ? 1 : 0,
					lineWidth: Math.max(0, finite(values.lineWidth, 1.5)),
					cornerRadius: Math.max(0, finite(values.cornerRadius, 0)),
					labelMode: { none: 0, dimensions: 1, percentage: 2 }[values.labelMode],
					labelPosition: { 'bottom-left': 0, 'bottom-right': 1, 'top-left': 2, 'top-right': 3 }[values.labelPosition],
					labelRadius: Math.max(0, finite(values.labelRadius, 0)),
					labelInset: values.labelInset ? 1 : 0,
					fontSize: Math.max(0, finite(values.fontSize, 0.015)),
					letterSpacing: finite(values.letterSpacing, 0),
					strokeColor: values.strokeColor,
					fillColor: values.fillColor,
					labelColor: values.labelColor,
					labelBackgroundColor: values.labelBackgroundColor,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);
				const variant = pipelines.update({ input: values.input }, output.texture);
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
				atlas.dispose();
			},
		};
	},
});
