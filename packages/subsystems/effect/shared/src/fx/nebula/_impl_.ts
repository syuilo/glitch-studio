import seedrandom from 'seedrandom';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

function boundedValue(value: number, minimum: number, maximum: number, fallback: number): number {
	return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
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
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code: colorRamp.shaderCode + '\n' + code,
			schema: {},
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [uniformLayout, colorRamp.layout],
		});
		let previousSeed: number | null = null;
		return {
			render: ctx => {
				const params = ctx.params;
				const output = ctx.outputDataMap.output.texture;
				const seed = Number.isFinite(params.seed) ? params.seed : 0;
				if (previousSeed !== seed) {
					// Seedはf32へ丸めずCPUで扱う。描画順やフレームごとの乱数に依存させない。
					const random = seedrandom(String(seed));
					uniformValues.set({ seedOffset: [random() * 256, random() * 256, random() * 256] });
					previousSeed = seed;
				}
				const time = boundedValue(params.time, -1e9, 1e9, 0);
				const noiseFrequency = boundedValue(params.noiseFrequency, 0.01, 64, 1.8);
				const rotation = Number.isFinite(params.rotation) ? params.rotation % 1 : 0;
				uniformValues.set({
					viewHalfExtent: getSpatialHalfExtent(output),
					cameraPosition: [boundedValue(params.cameraPosition[0], -1000, 1000, 0), boundedValue(params.cameraPosition[1], -1000, 1000, 0), boundedValue(params.cameraZ, -1000, 1000, 0.8)],
					center: [boundedValue(params.center[0], -1000, 1000, 0), boundedValue(params.center[1], -1000, 1000, 0), boundedValue(params.centerZ, -1000, 1000, -1.2)],
					zoom: boundedValue(params.zoom, 0.01, 100, 1),
					rotation: rotation * 2 * Math.PI,
					radius: boundedValue(params.radius, 0, 100, 1.5),
					density: boundedValue(params.density, 0, 100, 6),
					coverage: boundedValue(params.coverage, 0, 1, 0.3),
					noiseFrequency,
					octaves: Math.round(boundedValue(params.octaves, 1, 6, 5)),
					turbulence: boundedValue(params.turbulence, 0, 16, 1),
					// 256周期のノイズに合わせCPU側で折り返し、長時間の再生でも小数部を保つ。
					// 速度は共通単位/秒。ノイズ座標への換算はこの境界だけで行う。
					flowOffset: [
						time * boundedValue(params.flow[0], -10, 10, 0.04) * noiseFrequency % 256,
						time * boundedValue(params.flow[1], -10, 10, 0.02) * noiseFrequency % 256,
						time * boundedValue(params.flowZ, -10, 10, 0.02) * noiseFrequency % 256,
					],
					colorOffset: boundedValue(params.colorOffset, -1, 1, 0),
					emission: boundedValue(params.emission, 0, 1000, 4),
					absorption: boundedValue(params.absorption, 0, 100, 1.5),
					exposureMultiplier: 2 ** boundedValue(params.exposure, -20, 20, 0),
					softShoulder: params.toneMapping === 'softShoulder' ? 1 : 0,
					compositing: { volume: 0, opaque: 1, emission: 2 }[params.compositing],
					stepSize: boundedValue(params.stepSize, 0.0001, 1, 0.025),
					maximumSteps: Math.round(boundedValue(params.maximumSteps, 1, 2048, 192)),
					maximumTraceDistance: boundedValue(params.maximumTraceDistance, 0, 1000, 7),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampBindGroup = colorRamp.update(params.ramp);
				const variant = pipelines.update({}, output);
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
