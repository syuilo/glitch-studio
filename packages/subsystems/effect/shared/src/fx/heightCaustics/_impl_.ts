import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import traceCode from './trace.wgsl?raw';
import accumulateCode from './accumulate.wgsl?raw';
import blurCode from './blur.wgsl?raw';
import renderCode from './render.wgsl?raw';
import type definition from './_def_.ts';

function finiteOr(value: number, fallback: number) {
	return Number.isFinite(value) ? value : fallback;
}

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
		irradiance: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu, resolution }) => {
		const { device } = wgpu;
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const uniformLayoutEntry: GPUBindGroupLayoutEntry = { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } };
		const traceLayout = device.createBindGroupLayout({ entries: [uniformLayoutEntry] });
		const traceGroup = device.createBindGroup({ layout: traceLayout, entries: [uniformEntry] });
		const tracePipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code: commonCode + '\n' + traceCode,
			schema: { height: 'scalar' }, targets: [{ format: 'rgba32float' }],
			internalLayouts: [traceLayout], sampling: 'level0', scalarGradients: true,
		});
		const accumulateLayout = device.createBindGroupLayout({ entries: [
			uniformLayoutEntry,
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const accumulatePipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [accumulateLayout] }),
			compute: { module: device.createShaderModule({ code: commonCode + '\n' + accumulateCode }), entryPoint: 'accumulate' },
		});
		const blurLayout = device.createBindGroupLayout({ entries: [
			uniformLayoutEntry,
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		const illuminationFormat = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const blurModule = device.createShaderModule({ code: commonCode + '\n' + blurCode });
		const blurPipelines = ['blurHorizontal', 'blurVertical'].map(entryPoint => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [blurLayout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: blurModule, entryPoint, targets: [{ format: illuminationFormat }] },
		}));
		const renderLayout = device.createBindGroupLayout({ entries: [
			uniformLayoutEntry,
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [renderLayout] });
		const renderModule = device.createShaderModule({ code: commonCode + '\n' + renderCode });
		const renderPipelines = new Map<string, GPURenderPipeline>();

		function createSimulation(width: number, height: number) {
			const size = { width, height };
			// 光線の到達位置だけは常に32bit。half-floatへ量子化すると、高品質設定でも
			// サブピクセルの到達位置が失われ、固定小数へ集計する前に縞が生じてしまう。
			const rays = device.createTexture({ size, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
			const histogram = device.createBuffer({ size: width * height * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			const illumination = Array.from({ length: 2 }, () => device.createTexture({ size, format: illuminationFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
			const views = illumination.map(texture => texture.createView());
			return {
				width, height, histogram, raysView: rays.createView(), views,
				accumulateGroup: device.createBindGroup({ layout: accumulateLayout, entries: [uniformEntry, { binding: 1, resource: rays.createView() }, { binding: 2, resource: { buffer: histogram } }] }),
				// 横方向passでも参照先と描画先を分け、bind groupに同じattachmentを含めない。
				blurGroups: [views[1], views[0]].map(view => device.createBindGroup({ layout: blurLayout, entries: [uniformEntry, { binding: 1, resource: { buffer: histogram } }, { binding: 2, resource: view }] })),
				renderGroup: device.createBindGroup({ layout: renderLayout, entries: [uniformEntry, { binding: 1, resource: views[1] }] }),
				dispose: () => { rays.destroy(); histogram.destroy(); for (const texture of illumination) texture.destroy(); },
			};
		}

		let simulation: ReturnType<typeof createSimulation> | null = null;
		return {
			render: ctx => {
				const outputs = [
					ctx.usedOutputPorts?.has('output') === false ? null : ctx.outputDataMap.output,
					ctx.usedOutputPorts?.has('irradiance') === false ? null : ctx.outputDataMap.irradiance,
				];
				if (outputs.every(output => output == null)) return;
				const params = ctx.params;
				const samples = Math.round(Math.max(32, Math.min(1024, finiteOr(params.samples, 512))));
				const longestSide = Math.max(resolution.width, resolution.height);
				const width = Math.max(1, Math.round(samples * resolution.width / longestSide));
				const height = Math.max(1, Math.round(samples * resolution.height / longestSide));
				if (simulation == null || simulation.width !== width || simulation.height !== height) {
					simulation?.dispose();
					simulation = createSimulation(width, height);
				}
				const halfExtent = getSpatialHalfExtent(resolution);
				const angle = (finiteOr(params.lightAngle, 0) % 1) * 2 * Math.PI;
				const elevation = Math.max(0, Math.min(0.25, finiteOr(params.lightElevation, 0.25))) * 2 * Math.PI;
				const softness = Math.max(0, Math.min(0.05, finiteOr(params.softness, 0.004)));
				uniformValues.set({
					halfExtent, gridSize: [width, height],
					// Height Lightingと同じ右=0・時計回りで、光源へ向かう方向を表す。
					lightDirection: [Math.cos(angle) * Math.cos(elevation), -Math.sin(angle) * Math.cos(elevation), Math.sin(elevation)],
					heightScale: Math.max(-1e6, Math.min(1e6, finiteOr(params.heightScale, 0.05))),
					receiverDistance: Math.max(0, Math.min(1e6, finiteOr(params.receiverDistance, 0.2))),
					ior: Math.max(1, Math.min(10, finiteOr(params.ior, 1.333))),
					lightColor: params.lightColor,
					lightIntensity: Math.max(0, Math.min(1e6, finiteOr(params.lightIntensity, 1))),
					sigma: [softness * width / (2 * halfExtent[0]), softness * height / (2 * halfExtent[1])],
					maximumIrradiance: wgpu.enable32bitDataTextures ? 3.4028234663852886e38 : 65504,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				// 入力のFitは内部格子でなく最終出力の縦横比を基準にする。
				const trace = tracePipelines.update({ height: params.height }, resolution);
				const tracePass = ctx.createPassEncoderFor(ctx.commandEncoder, simulation.raysView);
				tracePass.setPipeline(trace.pipeline);
				tracePass.setBindGroup(0, traceGroup);
				tracePass.setBindGroup(tracePipelines.inputGroup, trace.bindGroup);
				tracePass.draw(3);
				tracePass.end();
				ctx.commandEncoder.clearBuffer(simulation.histogram);
				const accumulatePass = ctx.createComputePassEncoder(ctx.commandEncoder);
				accumulatePass.setPipeline(accumulatePipeline);
				accumulatePass.setBindGroup(0, simulation.accumulateGroup);
				accumulatePass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
				accumulatePass.end();
				for (let index = 0; index < 2; index++) {
					const blurPass = ctx.createPassEncoderFor(ctx.commandEncoder, simulation.views[index]);
					blurPass.setPipeline(blurPipelines[index]);
					blurPass.setBindGroup(0, simulation.blurGroups[index]);
					blurPass.draw(3);
					blurPass.end();
				}
				const outputMask = outputs.map(output => output == null ? '0' : '1').join('');
				let renderPipeline = renderPipelines.get(outputMask);
				if (renderPipeline == null) {
					renderPipeline = device.createRenderPipeline({
						layout: renderPipelineLayout, vertex: { module: wgpu.defaultVertexShaderModule },
						fragment: { module: renderModule, targets: outputs.map(output => output == null ? null : { format: output.texture.format }) },
					});
					renderPipelines.set(outputMask, renderPipeline);
				}
				const renderPass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: outputs.map(output => output == null ? null : {
					view: output.textureView, clearValue: [0, 0, 0, 0], loadOp: 'clear' as const, storeOp: 'store' as const,
				}) });
				renderPass.setPipeline(renderPipeline);
				renderPass.setBindGroup(0, simulation.renderGroup);
				renderPass.draw(3);
				renderPass.end();
			},
			dispose: () => { simulation?.dispose(); uniformBuffer.destroy(); tracePipelines.dispose(); },
		};
	},
});
