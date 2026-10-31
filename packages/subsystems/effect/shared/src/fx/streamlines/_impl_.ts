import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderInputBindings, generateShaderInputs } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode from './common.wgsl?raw';
import traceCode from './trace.wgsl?raw';
import maskCode from './mask.wgsl?raw';
import colorCode from './color.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({ size: resolution, format: wgpu.intermediateTextureFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution }) => {
		const shortDimension = Math.min(resolution.width, resolution.height);
		const aspect = [resolution.width / shortDimension, resolution.height / shortDimension];
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformEntry = { binding: 0, resource: { buffer: uniformBuffer } };
		const traceLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const maskLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
		] });
		const colorLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		] });
		// これは浮動小数点の場を保存するテクスチャではなく、画素の被覆率を保存する8bitのマスク。
		// MAX合成で線と矢尻の和集合を取り、半透明色を後段で一度だけ適用する。
		const coverageTexture = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
		const coverageView = coverageTexture.createView();
		const colorGroup = device.createBindGroup({ layout: colorLayout, entries: [uniformEntry, { binding: 1, resource: coverageView }] });
		const colorRamp = createColorRampBindings(device, 1);
		const maskModule = device.createShaderModule({ code: commonCode + '\n' + maskCode });
		const createMaskPipeline = (entryPoint: string) => device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [maskLayout] }),
			vertex: { module: maskModule, entryPoint },
			fragment: { module: maskModule, entryPoint: 'maskFragment', targets: [{
				format: 'rgba8unorm', blend: {
					color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
					alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
				},
			}] },
			primitive: { topology: 'triangle-list' },
		});
		const segments = createMaskPipeline('segmentVertex');
		const arrows = createMaskPipeline('arrowVertex');
		const dots = createMaskPipeline('dotVertex');

		function createVariant(vector: ShaderInput) {
			const generated = generateShaderInputs({ vector: 'vector' }, { vector }, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const trace = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [traceLayout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: generated.code + '\n' + commonCode + '\n' + traceCode }), entryPoint: 'traceStreamlines' },
				});
				const colorInputs = generateShaderInputs({ vector: 'vector' }, { vector }, 2, 'level0');
				const color = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [colorLayout, colorRamp.layout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: colorInputs.code + '\n' + commonCode + '\n' + colorRamp.shaderCode + '\n' + colorCode }), targets: [{ format: intermediateTextureFormat }] },
					primitive: { topology: 'triangle-list' },
				});
				return { trace, color, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		const variants = new Map<ShaderInput['kind'], ReturnType<typeof createVariant>>();

		function createResources(pointBytes: number, traceBytes: number) {
			const points = device.createBuffer({ size: pointBytes, usage: GPUBufferUsage.STORAGE });
			const traces = device.createBuffer({ size: traceBytes, usage: GPUBufferUsage.STORAGE });
			const entries = [uniformEntry, { binding: 1, resource: { buffer: points } }, { binding: 2, resource: { buffer: traces } }];
			return { pointBytes, traceBytes, points, traces,
				traceGroup: device.createBindGroup({ layout: traceLayout, entries }),
				maskGroup: device.createBindGroup({ layout: maskLayout, entries }),
			};
		}

		let resources: ReturnType<typeof createResources> | null = null;
		return {
			render: ctx => {
				if (ctx.params.lineWidth <= 0) {
					ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView).end();
					return;
				}
				const density = Math.min(64, Math.max(1, Math.floor(ctx.params.density)));
				const seedCount = aspect.map(value => Math.max(1, Math.floor(value * density)));
				const seeds = seedCount[0] * seedCount[1];
				const traceCount = seeds * 2;
				const maximumLength = Math.max(0.000001, ctx.params.maximumLength);
				const stepSize = Math.max(0.00001, ctx.params.stepSize);
				const maximumSteps = Math.min(2048, Math.max(1, Math.floor(ctx.params.maximumSteps)));
				const stepCount = Math.max(1, Math.min(maximumSteps, Math.ceil(maximumLength / stepSize)));
				const arrowSpacing = Math.max(0.001, ctx.params.arrowSpacing);
				const arrowCount = ctx.params.arrowSize <= 0 ? 0 : Math.max(0, Math.floor(Math.min(maximumLength, stepCount * stepSize) / arrowSpacing + 0.5));
				const pointBytes = traceCount * (stepCount + 1) * 8;
				const traceBytes = traceCount * 8;
				const bufferLimit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
				if (!Number.isSafeInteger(pointBytes) || pointBytes > bufferLimit || traceBytes > bufferLimit
					|| Math.ceil(traceCount / 64) > device.limits.maxComputeWorkgroupsPerDimension
					|| !Number.isSafeInteger(arrowCount) || traceCount * arrowCount > 0xffffffff) {
					throw new Error('Streamlines exceeds GPU resource limits. Reduce Seed Density, Maximum Steps or Maximum Length, or increase Arrow Spacing.');
				}
				if (resources == null || resources.pointBytes < pointBytes || resources.traceBytes < traceBytes) {
					const replacement = createResources(pointBytes, traceBytes);
					resources?.points.destroy();
					resources?.traces.destroy();
					resources = replacement;
				}
				uniformValues.set({ aspect, seedCount, seedSpacing: 1 / density, maximumLength, stepSize, stepCount, arrowSpacing, arrowCount,
					minimumMagnitude: Math.max(0, ctx.params.minimumMagnitude),
					directionSpace: ctx.params.directionSpace === 'displacement' ? 1 : 0,
					lineWidth: Math.max(0, ctx.params.lineWidth), arrowSize: Math.max(0, ctx.params.arrowSize), pixelSize: 1 / shortDimension,
					maximumMagnitude: Math.max(0.000001, ctx.params.maximumMagnitude), zeroColor: ctx.params.zeroColor, overflowColor: ctx.params.overflowColor,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				let variant = variants.get(ctx.params.vector.kind);
				if (variant == null) {
					variant = createVariant(ctx.params.vector);
					variants.set(ctx.params.vector.kind, variant);
				}
				const inputGroup = variant.bindings.update({ vector: ctx.params.vector }, resolution);
				const rampGroup = colorRamp.update(ctx.params.ramp);
				const tracePass = ctx.createComputePassEncoder(ctx.commandEncoder);
				tracePass.setPipeline(variant.trace);
				tracePass.setBindGroup(0, resources.traceGroup);
				tracePass.setBindGroup(1, inputGroup);
				tracePass.dispatchWorkgroups(Math.ceil(traceCount / 64));
				tracePass.end();
				const maskPass = ctx.createPassEncoderFor(ctx.commandEncoder, coverageView);
				maskPass.setBindGroup(0, resources.maskGroup);
				maskPass.setPipeline(segments);
				maskPass.draw(6, traceCount * stepCount);
				if (arrowCount > 0) {
					maskPass.setPipeline(arrows);
					maskPass.draw(6, traceCount * arrowCount);
				}
				maskPass.setPipeline(dots);
				maskPass.draw(6, seeds);
				maskPass.end();
				const colorPass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				colorPass.setPipeline(variant.color);
				colorPass.setBindGroup(0, colorGroup);
				colorPass.setBindGroup(1, rampGroup);
				colorPass.setBindGroup(2, inputGroup);
				colorPass.draw(6);
				colorPass.end();
			},
			dispose: () => {
				for (const variant of variants.values()) variant.bindings.dispose();
				colorRamp.dispose();
				resources?.points.destroy(); resources?.traces.destroy();
				coverageTexture.destroy(); uniformBuffer.destroy();
			},
		};
	},
});
