import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { implementEffect } from '../../effect-implementation.ts';
import type { EffectOutputData } from '../../effect-implementation.ts';
import type definition from './_def_.ts';
import { createIntegrationSchedule } from './integration-schedule.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		angle1: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		angle2: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		angularVelocity1: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		angularVelocity2: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);
		const shader = device.createShaderModule({ code: colorRamp.shaderCode + '\n' + code });
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [uniformLayout, colorRamp.layout] });
		const pipelines = new Map<number, GPURenderPipeline>();
		const spatialHalfExtent = getSpatialHalfExtent(resolution);
		const wrapAngle = (angle: number) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

		function createPipeline(outputs: (EffectOutputData | null)[], coloringMethod: number) {
			return device.createRenderPipeline({
				layout: pipelineLayout,
				vertex: { module: wgpu.defaultVertexShaderModule },
				fragment: {
					module: shader,
					constants: { RENDER_COLOR: outputs[0] != null ? 1 : 0, COLORING_METHOD: coloringMethod },
					// 未使用attachmentを省いてもlocationは固定し、全ポートの計算を一度の積分で共有する。
					targets: outputs.map(output => output == null ? null : { format: output.texture.format }),
				},
			});
		}

		return {
			render: ctx => {
				const outputPorts = ['output', 'angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'] as const;
				const outputs = outputPorts.map(port => ctx.usedOutputPorts == null || ctx.usedOutputPorts.has(port) ? ctx.outputDataMap[port] ?? null : null);
				const outputMask = outputs.reduce((mask, output, index) => output == null ? mask : mask | (1 << index), 0);
				if (outputMask === 0) { return; }
				const params = ctx.params;
				const schedule = createIntegrationSchedule(params.simulationTime, params.timeStep);
				for (const name of ['angleCenter1', 'angleCenter2', 'initialAngularVelocity1', 'initialAngularVelocity2', 'lengthRatio', 'massRatio', 'gravity', 'zoom', 'angularVelocityRange'] as const) {
					if (!Number.isFinite(Math.fround(params[name]))) throw new Error(`Double Pendulum Fractal requires a finite ${name} representable as f32.`);
				}
				for (const name of ['lengthRatio', 'massRatio', 'zoom', 'angularVelocityRange'] as const) {
					if (Math.fround(params[name]) <= 0) throw new Error(`Double Pendulum Fractal requires a positive ${name}.`);
				}
				const coloringMethod = outputs[0] == null ? 0 : ['sphericalRgb', 'angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'].indexOf(params.coloringMethod);
				uniformValues.set({
					spatialHalfExtent,
					pixelStep: [2 / resolution.width, 2 / resolution.height],
					angleCenter: [wrapAngle(params.angleCenter1), wrapAngle(params.angleCenter2)],
					initialAngularVelocity: [params.initialAngularVelocity1, params.initialAngularVelocity2],
					angleScale: 2 * Math.PI / params.zoom,
					lengthRatio: params.lengthRatio,
					massFraction: params.massRatio / (1 + params.massRatio),
					inverseTotalMass: 1 / (1 + params.massRatio),
					gravity: params.gravity,
					timeStep: params.timeStep,
					fullSteps: schedule.fullSteps,
					remainder: schedule.remainder,
					angularVelocityRange: params.angularVelocityRange,
					antialiasing: params.antialiasing ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampGroup = colorRamp.update(params.ramp);
				const pipelineKey = outputMask | (coloringMethod << 5);
				let pipeline = pipelines.get(pipelineKey);
				if (pipeline == null) {
					pipeline = createPipeline(outputs, coloringMethod);
					pipelines.set(pipelineKey, pipeline);
				}
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: outputs.map(output => output == null ? null : {
						view: output.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear' as const, storeOp: 'store' as const,
					}),
				});
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, uniformGroup);
				pass.setBindGroup(1, rampGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				colorRamp.dispose();
				uniformBuffer.destroy();
			},
		};
	},
});
