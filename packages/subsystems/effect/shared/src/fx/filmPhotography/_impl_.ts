import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createFilmPhotographyModel, DEFAULT_SETTINGS, packFilmPhotographyModel } from './model.ts';
import { SPECTRAL_TRIANGLES } from './spectral.ts';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = `const SPECTRAL_TRIANGLE_COUNT = ${SPECTRAL_TRIANGLES.length}u;\n${shaderCode}`;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const initialData = packFilmPhotographyModel(createFilmPhotographyModel(DEFAULT_SETTINGS));
		const buffer = device.createBuffer({ size: initialData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] });
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', exposure: 'scalar', printExposure: 'scalar' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }], internalLayouts: [layout], sampling: 'level0',
		});
		let previousSettings: string | null = null;
		return {
			render: ctx => {
				const { redLayer, greenLayer, blueLayer, base, printer, paper } = ctx.params;
				const settings = { redLayer, greenLayer, blueLayer, base, printer, paper };
				const settingsKey = JSON.stringify(settings);
				if (settingsKey !== previousSettings) {
					// 材料の変更時だけ分光係数を更新する。露出・入力画像・時刻の変化では
					// 再計算せず、画素ごとの露出を含めて同じGPUモデルを利用する。
					device.queue.writeBuffer(buffer, 0, packFilmPhotographyModel(createFilmPhotographyModel(settings)));
					previousSettings = settingsKey;
				}
				const variant = pipelines.update({ input: ctx.params.input, exposure: ctx.params.exposure, printExposure: ctx.params.printExposure }, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => { pipelines.dispose(); buffer.destroy(); },
		};
	},
});
