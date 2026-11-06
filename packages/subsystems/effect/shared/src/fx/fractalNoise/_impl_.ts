import seedrandom from 'seedrandom';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import simplexNoiseCode from '../../noise/simplex-noise.wgsl?raw';
import shaderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';

const code = simplexNoiseCode + '\n' + shaderCode;

// shader.wgslの分岐と対応する。方式やモードの変更ではpipelineを作り直さない。
const noiseTypes = { value: 0, simplex: 1, perlin: 2, worley: 3 } as const;
const fractalModes = { fbm: 0, turbulence: 1, ridged: 2, pingPong: 3 } as const;

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { coordinates: 'vector', density: 'vector', offset: 'vector', gain: 'scalar', lacunarity: 'scalar', pingPongStrength: 'scalar', outputMin: 'scalar', outputMax: 'scalar' },
			targets: [{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' }],
			internalLayouts: [layout],
			sampling: 'level0',
		});
		let previousSeed: number | null = null;
		return {
			render: ctx => {
				if (ctx.params.seed !== previousSeed) {
					previousSeed = ctx.params.seed;
					// 大きなSeedもf32へ丸めずCPUで扱い、ノイズ座標は精度を保てる範囲に置く。
					const random = seedrandom(String(previousSeed));
					uniformValues.set({ seedOffset: [random() * 256, random() * 256, random() * 256] });
				}
				const referenceLength = getSizeReferenceLength(ctx.params.sizeReference, resolution);
				const rotation = ctx.params.octaveRotation * 2 * Math.PI;
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution),
					referenceScale: Math.max(resolution.width, resolution.height) / referenceLength,
					coordinateSource: ctx.params.coordinateSource === 'input' ? 1 : 0,
					noiseType: noiseTypes[ctx.params.noiseType],
					fractalMode: fractalModes[ctx.params.fractalMode],
					octaves: Number.isFinite(ctx.params.octaves) ? Math.min(16, Math.max(1, Math.round(ctx.params.octaves))) : 4,
					octaveRotation: [Math.cos(rotation), Math.sin(rotation)],
					time: ctx.params.time,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = pipelines.update({
					coordinates: ctx.params.coordinates,
					density: ctx.params.density,
					offset: ctx.params.offset,
					gain: ctx.params.gain,
					lacunarity: ctx.params.lacunarity,
					pingPongStrength: ctx.params.pingPongStrength,
					outputMin: ctx.params.outputMin,
					outputMax: ctx.params.outputMax,
				}, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
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
