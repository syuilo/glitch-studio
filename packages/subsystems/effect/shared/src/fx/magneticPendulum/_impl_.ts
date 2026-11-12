import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { MAXIMUM_MAGNET_COUNT, MAGNETIC_PENDULUM_MINIMUM_ZOOM } from './_def_.ts';
import code from './shader.wgsl?raw';
import { getMagneticPendulumMaximumSteps, getMagneticPendulumRenderWorkloadHint } from './render-workload.ts';
import type { EffectOutputData } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

// 公開座標の0.25を内部モデルの長さ1に対応させる。磁石の既定配置を半径1で計算しつつ、
// UIの位置・高さ・速度は他のエフェクトと同じ長辺全体=1の共通単位で扱う。
const SIMULATION_UNITS_PER_SPATIAL_UNIT = 4;

export default implementEffect<typeof definition>({
	getRenderWorkloadHint: getMagneticPendulumRenderWorkloadHint,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		basinValue: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		settlingTime: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		convergedMask: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		travelDistance: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		// 1磁石をvec4f(position.xy, strength, heightSquared)で格納し、CPUとGPUのalignmentを揃える。
		// 高さの二乗はCPUで計算し、従来の未使用成分へ格納して転送量とGPUの演算数を増やさない。
		const magnetValues = new Float32Array(MAXIMUM_MAGNET_COUNT * 4);
		const magnetBuffer = device.createBuffer({ size: magnetValues.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const basinValues = new Float32Array(MAXIMUM_MAGNET_COUNT);
		const basinValueBuffer = device.createBuffer({ size: basinValues.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const group = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: magnetBuffer } },
			{ binding: 2, resource: { buffer: basinValueBuffer } },
		] });

		function createPipelines(outputs: (EffectOutputData | null)[]) {
			return createShaderInputPipeline({
				device,
				vertex: wgpu.defaultVertexShaderModule,
				code,
				schema: { magnetColors: { array: 'color' }, unconvergedColor: 'color', damping: 'scalar', restoringStrength: 'scalar' },
				// 出力locationを固定したまま未使用のattachmentを省き、積分は一度で全出力へ共有する。
				targets: outputs.map(output => output == null ? null : { format: output.texture.format }),
				constants: {
					RENDER_COLOR: outputs[0] != null ? 1 : 0,
					CALCULATE_SCALARS: outputs.slice(1).some(output => output != null) ? 1 : 0,
					// 距離が不要な場合は、各積分ステップのlengthと加算をコンパイル時に除去する。
					CALCULATE_TRAVEL_DISTANCE: outputs[4] != null ? 1 : 0,
				},
				internalLayouts: [layout],
				// 収束先や終了ステップは画素ごとに異なるため、配色も明示LODで読む。
				sampling: 'level0',
			});
		}

		const pipelinesByOutputs = new Map<number, ReturnType<typeof createPipelines>>();
		const spatialHalfExtent = getSpatialHalfExtent(resolution);
		return {
			render: ctx => {
				const outputs = [
					ctx.usedOutputPorts == null || ctx.usedOutputPorts.has('output') ? ctx.outputDataMap.output : null,
					ctx.outputDataMap.basinValue ?? null,
					ctx.outputDataMap.settlingTime ?? null,
					ctx.outputDataMap.convergedMask ?? null,
					ctx.outputDataMap.travelDistance ?? null,
				];
				const outputMask = outputs.reduce((mask, output, index) => output == null ? mask : mask | (1 << index), 0);
				if (outputMask === 0) { return; }
				if (ctx.params.magnets.length > MAXIMUM_MAGNET_COUNT) {
					throw new Error(`Magnetic Pendulum supports at most ${MAXIMUM_MAGNET_COUNT} magnets.`);
				}
				for (const [index, magnet] of ctx.params.magnets.entries()) {
					const magnetHeight = Math.max(0.005, magnet.height) * SIMULATION_UNITS_PER_SPATIAL_UNIT;
					magnetValues.set([
						magnet.position[0] * SIMULATION_UNITS_PER_SPATIAL_UNIT,
						magnet.position[1] * SIMULATION_UNITS_PER_SPATIAL_UNIT,
						Math.max(0, magnet.strength),
						magnetHeight * magnetHeight,
					], index * 4);
					basinValues[index] = magnet.value;
				}
				const captureRadius = Math.max(0.001, ctx.params.captureRadius) * SIMULATION_UNITS_PER_SPATIAL_UNIT;
				const captureSpeed = Math.max(0, ctx.params.captureSpeed) * SIMULATION_UNITS_PER_SPATIAL_UNIT;
				uniformValues.set({
					spatialHalfExtent: spatialHalfExtent.map(value => value * SIMULATION_UNITS_PER_SPATIAL_UNIT),
					pixelStep: [2 / resolution.width, 2 / resolution.height],
					viewCenter: ctx.params.view.center.map(value => value * SIMULATION_UNITS_PER_SPATIAL_UNIT),
					initialVelocity: ctx.params.initialVelocity.map(value => value * SIMULATION_UNITS_PER_SPATIAL_UNIT),
					zoom: Math.max(MAGNETIC_PENDULUM_MINIMUM_ZOOM, ctx.params.view.zoom),
					timeStep: Math.min(0.1, Math.max(0.001, ctx.params.timeStep)),
					captureRadiusSquared: captureRadius * captureRadius,
					captureSpeedSquared: captureSpeed * captureSpeed,
					settlingShading: Math.min(1, Math.max(0, ctx.params.settlingShading)),
					maximumSteps: getMagneticPendulumMaximumSteps(ctx.params.maximumSteps),
					antialiasing: ctx.params.antialiasing ? 1 : 0,
					unconvergedValue: ctx.params.unconvergedValue,
					travelDistanceScale: 1 / SIMULATION_UNITS_PER_SPATIAL_UNIT,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				device.queue.writeBuffer(magnetBuffer, 0, magnetValues);
				device.queue.writeBuffer(basinValueBuffer, 0, basinValues);
				let pipelines = pipelinesByOutputs.get(outputMask);
				if (pipelines == null) {
					pipelines = createPipelines(outputs);
					pipelinesByOutputs.set(outputMask, pipelines);
				}
				const variant = pipelines.update({
					magnetColors: ctx.params.magnets.map(magnet => magnet.color),
					unconvergedColor: ctx.params.unconvergedColor,
					damping: ctx.params.damping,
					restoringStrength: ctx.params.restoringStrength,
				}, resolution);
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: outputs.map(output => output == null ? null : {
						view: output.textureView,
						clearValue: [0, 0, 0, 0],
						loadOp: 'clear' as const,
						storeOp: 'store' as const,
					}),
				});
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const pipelines of pipelinesByOutputs.values()) pipelines.dispose();
				uniformBuffer.destroy();
				magnetBuffer.destroy();
				basinValueBuffer.destroy();
			},
		};
	},
});
