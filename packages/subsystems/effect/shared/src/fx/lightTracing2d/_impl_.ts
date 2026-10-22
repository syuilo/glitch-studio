import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import prepareCode from './prepare.wgsl?raw';
import jumpCode from './jump.wgsl?raw';
import traceCode from './trace.wgsl?raw';
import compositeCode from './composite.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, params, resolution }) => {
		const { device } = wgpu;
		const dataFormat = wgpu.enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const distanceFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const texture = (size: { width: number; height: number }, format: GPUTextureFormat) => {
			const image = device.createTexture({ size, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			return { texture: image, view: image.createView() };
		};
		// 遮蔽物と光源を縮小すると細線を失うため、幾何情報は出力と同じ解像度で保持する。
		const scene = texture(resolution, wgpu.intermediateTextureFormat);
		const seeds = [texture(resolution, dataFormat), texture(resolution, dataFormat)];
		const distance = texture(resolution, distanceFormat);
		const clampParameter = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
		const lightingResolution = (scale: number) => {
			const clampedScale = clampParameter(scale, 0.25, 1, 0.5);
			return { width: Math.max(1, Math.round(resolution.width * clampedScale)), height: Math.max(1, Math.round(resolution.height * clampedScale)) };
		};
		let lighting = texture(lightingResolution(params.resolutionScale), dataFormat);
		const uniformEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } };
		const textureEntry = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
		const prepareLayout = device.createBindGroupLayout({ entries: [uniformEntry] });
		const jumpLayout = device.createBindGroupLayout({ entries: [uniformEntry, textureEntry(1), { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const traceLayout = device.createBindGroupLayout({ entries: [uniformEntry, textureEntry(1), textureEntry(2)] });
		const compositeLayout = device.createBindGroupLayout({ entries: [uniformEntry, textureEntry(1), textureEntry(2)] });
		const preparePipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code: commonCode + '\n' + prepareCode,
			schema: { input: 'color' },
			sampling: 'level0',
			internalLayouts: [prepareLayout],
			entryPoint: 'prepare',
			targets: [{ format: wgpu.intermediateTextureFormat }, { format: dataFormat }],
		});
		const pipeline = (code: string, entryPoint: string, layout: GPUBindGroupLayout, format: GPUTextureFormat) => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code: commonCode + '\n' + code }), entryPoint, targets: [{ format }] },
			primitive: { topology: 'triangle-list' },
		});
		const jumpPipeline = pipeline(jumpCode, 'jumpFlood', jumpLayout, dataFormat);
		const distancePipeline = pipeline(jumpCode, 'distanceField', jumpLayout, distanceFormat);
		const tracePipeline = pipeline(traceCode, 'trace', traceLayout, dataFormat);
		const compositePipeline = pipeline(compositeCode, 'composite', compositeLayout, wgpu.intermediateTextureFormat);
		const uniformResource = { binding: 0, resource: { buffer: uniformBuffer } };
		const prepareGroup = device.createBindGroup({ layout: prepareLayout, entries: [uniformResource] });
		const jumpSteps: number[] = [];
		for (let step = 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(resolution.width, resolution.height))) - 1); step >= 1; step /= 2) jumpSteps.push(step);
		// JFA+1。最後に隣接画素でもう一度候補を伝播し、近似誤差を減らす。
		jumpSteps.push(1);
		const jumpPasses = jumpSteps.map((step, index) => {
			// writeBufferを同じbufferへ繰り返すと全パスが最後の値を読むため、歩幅ごとに所有する。
			const buffer = device.createBuffer({ size: 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(buffer, 0, new Uint32Array([step]));
			const group = device.createBindGroup({ layout: jumpLayout, entries: [uniformResource, { binding: 1, resource: seeds[index % 2].view }, { binding: 2, resource: { buffer } }] });
			return { buffer, group, target: seeds[(index + 1) % 2].view };
		});
		const distanceGroup = device.createBindGroup({ layout: jumpLayout, entries: [uniformResource, { binding: 1, resource: seeds[jumpSteps.length % 2].view }, { binding: 2, resource: { buffer: jumpPasses[0].buffer } }] });
		const traceGroup = device.createBindGroup({ layout: traceLayout, entries: [uniformResource, { binding: 1, resource: distance.view }, { binding: 2, resource: scene.view }] });
		const makeCompositeGroup = () => device.createBindGroup({ layout: compositeLayout, entries: [uniformResource, { binding: 1, resource: scene.view }, { binding: 2, resource: lighting.view }] });
		let compositeGroup = makeCompositeGroup();
		const draw = (pass: GPURenderPassEncoder, renderPipeline: GPURenderPipeline, group: GPUBindGroup) => {
			pass.setPipeline(renderPipeline);
			pass.setBindGroup(0, group);
			pass.draw(6);
			pass.end();
		};
		return {
			render: (ctx) => {
				const size = lightingResolution(ctx.params.resolutionScale);
				if (size.width !== lighting.texture.width || size.height !== lighting.texture.height) {
					lighting.texture.destroy();
					lighting = texture(size, dataFormat);
					compositeGroup = makeCompositeGroup();
				}
				const emissionStrength = clampParameter(ctx.params.emissionStrength, 0, 10, 2);
				uniformValues.set({
					sceneSize: [resolution.width, resolution.height],
					lightingSize: [size.width, size.height],
					emissionStrength,
					absorption: clampParameter(ctx.params.absorption, 0, 10, 1),
					alphaThreshold: clampParameter(ctx.params.alphaThreshold, 0, 1, 0.01),
					rayCount: Math.round(clampParameter(ctx.params.rayCount, 4, 256, 64)),
					maxSteps: Math.round(clampParameter(ctx.params.maxSteps, 8, 512, 128)),
					seed: Math.trunc(clampParameter(ctx.params.seed, -2147483648, 2147483647, 0)) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const prepared = preparePipelines.update({ input: ctx.params.input }, resolution);
				const preparePass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [scene.view, seeds[0].view].map(view => ({ view, loadOp: 'clear', storeOp: 'store' })) });
				preparePass.setPipeline(prepared.pipeline);
				preparePass.setBindGroup(0, prepareGroup);
				preparePass.setBindGroup(1, prepared.bindGroup);
				preparePass.draw(6);
				preparePass.end();
				if (emissionStrength > 0) {
					for (const { group, target } of jumpPasses) draw(ctx.createPassEncoderFor(ctx.commandEncoder, target), jumpPipeline, group);
					draw(ctx.createPassEncoderFor(ctx.commandEncoder, distance.view), distancePipeline, distanceGroup);
					draw(ctx.createPassEncoderFor(ctx.commandEncoder, lighting.view), tracePipeline, traceGroup);
				}
				draw(ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView), compositePipeline, compositeGroup);
			},
			dispose: () => {
				preparePipelines.dispose();
				uniformBuffer.destroy();
				for (const { buffer } of jumpPasses) buffer.destroy();
				for (const image of [scene, ...seeds, distance, lighting]) image.texture.destroy();
			},
		};
	},
});
