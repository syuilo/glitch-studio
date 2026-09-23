import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import { inputUvScale } from '../../shader-input.ts';
import commonCode from './common.wgsl?raw';
import internalCode from './shader.wgsl?raw';
import inputCode from './input.wgsl?raw';
import type definition from './_def_.ts';

// 光の広がりを決める段階は固定し、Qualityに応じて細部用の段階を手前に追加する。
const haloSize = 512;
const haloLevelCount = 6;

export default implementEffect<typeof definition, 'shaderInput'>({
	inputMode: 'shaderInput',
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, params, resolution }) => {
		const { device } = wgpu;
		const module = device.createShaderModule({ code: commonCode + '\n' + internalCode });
		const uniformValues = makeStructuredView(makeShaderDataDefinitions(commonCode).uniforms.uniforms);
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
		const downsamplePipeline = makePipeline('downsample', wgpu.intermediateTextureFormat);
		// Blend into the finer level in place; no second pyramid or detail sample.
		const blend: GPUBlendComponent = { srcFactor: 'constant', dstFactor: 'one-minus-constant' };
		const upsamplePipeline = makePipeline('upsample', wgpu.intermediateTextureFormat, { color: blend, alpha: blend });
		const prefilterLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const prefilterGroup = device.createBindGroup({ layout: prefilterLayout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
		] });
		const inputPipelineOptions = {
			device, vertex: wgpu.defaultVertexShaderModule, code: commonCode + '\n' + inputCode,
			schema: { input: 'color' }, sampling: 'level0',
		} as const;
		const prefilterPipelines = createShaderInputPipeline({ ...inputPipelineOptions, internalLayouts: [prefilterLayout], entryPoint: 'prefilter', targets: [{ format: wgpu.intermediateTextureFormat }] });
		const compositePipelines = createShaderInputPipeline({ ...inputPipelineOptions, internalLayouts: [bindGroupLayout], entryPoint: 'composite', targets: [{ format: wgpu.intermediateTextureFormat }] });
		const longestSide = Math.max(resolution.width, resolution.height);
		const clamp = (value: number, max: number, fallback: number) => Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
		const getRadiusSettings = (value: readonly number[]) => {
			const x = clamp(value[0], 1, 0.7);
			const y = clamp(value[1], 1, 0.7);
			const radius = Math.max(x, y);
			return { radius, scaleX: radius > 0 ? x / radius : 0, scaleY: radius > 0 ? y / radius : 0 };
		};
		const getWorkingSize = (quality: number) => Math.min(device.limits.maxTextureDimension2D, Math.max(haloSize, Math.round(longestSide * Math.max(0.1, clamp(quality, 1, 0.5)))));
		const makeBindGroup = (source: GPUTextureView) => device.createBindGroup({
			layout: bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: source },
			],
		});
		const makePass = (view: GPUTextureView, loadOp: GPULoadOp = 'clear'): GPURenderPassDescriptor => ({
			colorAttachments: [{ view, loadOp, storeOp: 'store', clearValue: [0, 0, 0, 0] }],
		});
		const makePyramid = (workingSize: number, scaleX: number, scaleY: number) => {
			const sizes: number[] = [];
			// 一度に大きく縮小すると細い光を取りこぼすため、最大でも約1/2ずつ縮小する。
			for (let size = workingSize; size > haloSize; size /= 2) sizes.push(size);
			const detailLevelCount = sizes.length;
			for (let i = 0; i < haloLevelCount; i++) sizes.push(haloSize / 2 ** i);
			const levels = sizes.map(size => {
				// 半径の小さい軸は縮小を抑え、0の軸は全段で作業解像度を維持する。
				// 両軸が同じ半径なら従来と同じピラミッドになる。
				const reduction = workingSize / size - 1;
				const width = resolution.width * workingSize / longestSide / (1 + reduction * scaleX);
				const height = resolution.height * workingSize / longestSide / (1 + reduction * scaleY);
				const texture = device.createTexture({
					size: [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))],
					format: wgpu.intermediateTextureFormat,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				return { texture, view: texture.createView() };
			});
			return {
				workingSize, scaleX, scaleY, detailLevelCount, levels,
				downPasses: levels.map(({ view }) => makePass(view)),
				upPasses: levels.slice(0, -1).map(({ view }) => makePass(view, 'load')),
				downGroups: levels.slice(0, -1).map(({ view }) => makeBindGroup(view)),
				upGroups: levels.slice(1).map(({ view }) => makeBindGroup(view)),
			};
		};
		const initialRadius = getRadiusSettings(params.radius);
		let pyramid = makePyramid(getWorkingSize(params.quality), initialRadius.scaleX, initialRadius.scaleY);
		let compositeGroup = makeBindGroup(pyramid.levels[0].view);
		const draw = (pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, group: GPUBindGroup, inputGroup?: GPUBindGroup) => {
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			if (inputGroup) pass.setBindGroup(1, inputGroup);
			pass.draw(6);
			pass.end();
		};

		return {
			render: (ctx) => {
				const workingSize = getWorkingSize(ctx.params.quality);
				const { radius, scaleX, scaleY } = getRadiusSettings(ctx.params.radius);
				const resized = workingSize !== pyramid.workingSize || scaleX !== pyramid.scaleX || scaleY !== pyramid.scaleY;
				if (resized) {
					for (const { texture } of pyramid.levels) texture.destroy();
					pyramid = makePyramid(workingSize, scaleX, scaleY);
					compositeGroup = makeBindGroup(pyramid.levels[0].view);
				}
				const { levels, downPasses, upPasses, downGroups, upGroups } = pyramid;
				const input = ctx.params.input;
				const strength = input.kind === 'uniform' && input.value.every(value => value === 0) ? 0 : clamp(ctx.params.strength, 5, 1);
				const outputSize = ctx.outputDataMap.output.texture;
				// 作業解像度の丸めや非等方な縮小でfitが変わらないよう、最終出力を基準にする。
				// 入力の1画素を出力UVへ逆変換し、抽出時のサンプル間隔にも同じfitを反映する。
				let prefilterOffset = [0, 0];
				if (input.kind === 'texture') {
					const scale = inputUvScale(input.texture, outputSize, input.fitMode);
					prefilterOffset = [
						Math.max(0, 1 / levels[0].texture.width - 1 / (input.texture.width * scale[0])) * 0.5,
						Math.max(0, 1 / levels[0].texture.height - 1 / (input.texture.height * scale[1])) * 0.5,
					];
				}
				uniformValues.set({
					strength,
					radiusScale: [scaleX, scaleY],
					threshold: clamp(ctx.params.threshold, 1, 0.7),
					softKnee: clamp(ctx.params.softKnee, 1, 0.5),
					prefilterOffset,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				if (strength > 0) {
					const prefilter = prefilterPipelines.update({ input }, outputSize);
					draw(ctx.createPassEncoder(ctx.commandEncoder, downPasses[0]), prefilter.pipeline, prefilterGroup, prefilter.bindGroup);
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
				const composite = compositePipelines.update({ input }, outputSize);
				draw(ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView), composite.pipeline, compositeGroup, composite.bindGroup);
			},
			dispose: () => {
				prefilterPipelines.dispose();
				compositePipelines.dispose();
				uniformBuffer.destroy();
				for (const { texture } of pyramid.levels) texture.destroy();
			},
		};
	},
});
