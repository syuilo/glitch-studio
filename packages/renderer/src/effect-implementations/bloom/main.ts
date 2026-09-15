import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from '@glitch/shared/effect-definitions/bloom.ts';

// 光の広がりを決める段階は固定し、Qualityに応じて細部用の段階を手前に追加する。
const haloSize = 512;
const haloLevelCount = 6;

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu, params, resolution, fallbackTexture }) => {
		const { device } = wgpu;
		const module = device.createShaderModule({ code });
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
		const uniformBuffer = device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		const bindGroupLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
				{ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			],
		});
		const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
		const makePipeline = (entryPoint: string, format: GPUTextureFormat, blend?: GPUBlendState) => device.createRenderPipeline({
			layout,
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module, entryPoint, targets: [{ format, blend }] },
			primitive: { topology: 'triangle-list' },
		});
		// 縮小・拡大の各段階もrendererで指定された画像形式に揃える。
		const prefilterPipeline = makePipeline('prefilter', wgpu.intermediateTextureFormat);
		const downsamplePipeline = makePipeline('downsample', wgpu.intermediateTextureFormat);
		// Blend into the finer level in place; no second pyramid or detail sample.
		const blend: GPUBlendComponent = { srcFactor: 'constant', dstFactor: 'one-minus-constant' };
		const upsamplePipeline = makePipeline('upsample', wgpu.intermediateTextureFormat, { color: blend, alpha: blend });
		const compositePipeline = makePipeline('composite', wgpu.intermediateTextureFormat);
		const longestSide = Math.max(resolution.width, resolution.height);
		const clamp = (value: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
		const getWorkingSize = (quality: number) => Math.min(device.limits.maxTextureDimension2D, Math.max(haloSize, Math.round(longestSide * Math.max(0.1, clamp(quality, 1, 0.5)))));
		const makeBindGroup = (source: GPUTextureView, detail = source) => device.createBindGroup({
			layout: bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: source },
				{ binding: 3, resource: detail },
			],
		});
		const makePass = (view: GPUTextureView, loadOp: GPULoadOp = 'clear'): GPURenderPassDescriptor => ({
			colorAttachments: [{ view, loadOp, storeOp: 'store', clearValue: [0, 0, 0, 0] }],
		});
		const makePyramid = (workingSize: number) => {
			const sizes: number[] = [];
			// 一度に大きく縮小すると細い光を取りこぼすため、最大でも約1/2ずつ縮小する。
			for (let size = workingSize; size > haloSize; size /= 2) sizes.push(size);
			const detailLevelCount = sizes.length;
			for (let i = 0; i < haloLevelCount; i++) sizes.push(haloSize / 2 ** i);
			const levels = sizes.map(size => {
				const scale = size / longestSide;
				const texture = device.createTexture({
					size: [Math.max(1, Math.round(resolution.width * scale)), Math.max(1, Math.round(resolution.height * scale))],
					format: wgpu.intermediateTextureFormat,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				return { texture, view: texture.createView() };
			});
			return {
				workingSize, detailLevelCount, levels,
				downPasses: levels.map(({ view }) => makePass(view)),
				upPasses: levels.slice(0, -1).map(({ view }) => makePass(view, 'load')),
				downGroups: levels.slice(0, -1).map(({ view }) => makeBindGroup(view)),
				upGroups: levels.slice(1).map(({ view }) => makeBindGroup(view)),
			};
		};
		let pyramid = makePyramid(getWorkingSize(params.quality));
		let inputTexture: GPUTexture | null | undefined;
		let prefilterGroup: GPUBindGroup;
		let compositeGroup: GPUBindGroup;
		const updateInput = (input: GPUTexture | null) => {
			inputTexture = input;
			const view = (input ?? fallbackTexture).createView();
			prefilterGroup = makeBindGroup(view);
			compositeGroup = makeBindGroup(view, pyramid.levels[0].view);
		};
		updateInput(params.input);
		const draw = (pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, group: GPUBindGroup) => {
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(6);
			pass.end();
		};

		return {
			render: (ctx) => {
				const workingSize = getWorkingSize(ctx.params.quality);
				const resized = workingSize !== pyramid.workingSize;
				if (resized) {
					for (const { texture } of pyramid.levels) texture.destroy();
					pyramid = makePyramid(workingSize);
				}
				if (resized || ctx.params.input !== inputTexture) updateInput(ctx.params.input);
				const { levels, downPasses, upPasses, downGroups, upGroups } = pyramid;
				const strength = inputTexture == null ? 0 : clamp(ctx.params.strength, 5, 1);
				const radius = clamp(ctx.params.radius, 1, 0.7);
				uniformValues.set({
					strength,
					threshold: clamp(ctx.params.threshold, 1, 0.7),
					softKnee: clamp(ctx.params.softKnee, 1, 0.5),
					prefilterTexel: [1 / levels[0].texture.width, 1 / levels[0].texture.height],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				if (strength > 0) {
					draw(ctx.createPassEncoder(ctx.commandEncoder, downPasses[0]), prefilterPipeline, prefilterGroup);
					if (radius > 0) {
						for (let i = 1; i < levels.length; i++) {
							draw(ctx.createPassEncoder(ctx.commandEncoder, downPasses[i]), downsamplePipeline, downGroups[i - 1]);
						}
						for (let i = levels.length - 2; i >= 0; i--) {
							const pass = ctx.createPassEncoder(ctx.commandEncoder, upPasses[i]);
							// 細部用の中間段階では光をそのまま拡大し、最上段でだけ細部と混ぜる。
							// 段階が増えてもRadiusが繰り返し掛かって光が弱まったり狭まったりしない。
							const weight = i === 0 || i > pyramid.detailLevelCount ? radius : 1;
							pass.setBlendConstant([weight, weight, weight, weight]);
							draw(pass, upsamplePipeline, upGroups[i]);
						}
					}
				}
				draw(ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView), compositePipeline, compositeGroup);
			},
			dispose: () => {
				uniformBuffer.destroy();
				for (const { texture } of pyramid.levels) texture.destroy();
			},
		};
	},
});
