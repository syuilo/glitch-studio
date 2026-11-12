import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

function finiteValue(value: number, fallback: number): number {
	return Number.isFinite(Math.fround(value)) ? value : fallback;
}

function boundedValue(value: number, minimum: number, maximum: number, fallback: number): number {
	return Math.min(maximum, Math.max(minimum, finiteValue(value, fallback)));
}

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code: colorRamp.shaderCode + '\n' + code,
			schema: { orbColor: 'color' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [uniformLayout, colorRamp.layout],
		});
		return {
			render: ctx => {
				const params = ctx.params;
				const output = ctx.outputDataMap.output.texture;
				const time = finiteValue(params.time, 0);
				const fullTurn = 2 * Math.PI;
				// 画面全体で同じ軌道と回転はCPUで計算する。Timeは絶対時刻として扱い、
				// 描画履歴やctx.timeDeltaを使わず、逆再生・任意時刻へのシークを再現可能にする。
				uniformValues.set({
					aspectRatio: output.width / output.height,
					zoom: boundedValue(params.zoom, 0.01, 100, 1),
					rotation: (finiteValue(params.rotation, 0) % 1) * fullTurn,
					foldFrequency: boundedValue(params.foldFrequency, 0.01, 16, 1),
					foldAmount: boundedValue(params.foldAmount, 0, 16, 1),
					sheetTilt: [boundedValue(params.sheetTilt[0], -16, 16, 0.3), boundedValue(params.sheetTilt[1], -16, 16, 0.9)],
					glowWidth: boundedValue(params.glowWidth, 0, 100, 1),
					flowOffset: [0, time * 0.2, time * 0.6],
					spin: (time * 0.03 + 0.3) % fullTurn,
					orbPosition: [1.1 * Math.sin(time * 0.21), 0.5 * Math.cos(time * 0.17) + 0.45, 2.4 + 0.4 * Math.sin(time * 0.13)],
					sheetStrength: boundedValue(params.sheetStrength, 0, 1000, 1),
					orbStrength: boundedValue(params.orbStrength, 0, 1000, 1),
					colorPhase: finiteValue(params.colorPhase, 0) % 1,
					colorMode: params.colorMode === 'colorRamp' ? 1 : 0,
					colorFrequency: boundedValue(params.colorFrequency, 0, 100, 1),
					exposureMultiplier: 2 ** boundedValue(params.exposure, -20, 20, 0),
					softShoulder: params.toneMapping === 'softShoulder' ? 1 : 0,
					outputAlpha: params.compositing === 'opaque' ? 1 : 0,
					maximumSteps: Math.round(boundedValue(params.maximumSteps, 1, 120, 120)),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampBindGroup = colorRamp.update(params.ramp);
				const variant = pipelines.update({ orbColor: params.orbColor }, output);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, uniformGroup);
				pass.setBindGroup(1, rampBindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
				colorRamp.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
