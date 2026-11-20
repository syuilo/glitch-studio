import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { inputUvScale } from '@gs/shared/gpu/shader-input.ts';
import { colorBlendModes } from '@gs/shared/color-blend.ts';
import blendCode from '@gs/shared/color-blend.wgsl?raw';
import { beginOutputPass, bindParameterValues, createFixedInputPipeline } from '../../multipass.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.wgsl?shader';
import internalCode from './shader.wgsl?raw';
import inputCode from './input.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

// 光の広がりを決める段階は固定し、Qualityに応じて細部用の段階を手前に追加する。
const haloSize = 512;
const haloLevelCount = 6;

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const { device } = context;
		const module = device.createShaderModule({ code: commonCode + '\n' + internalCode });
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
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
			vertex: { module: context.defaultVertexShaderModule },
			fragment: { module, entryPoint, targets: [{ format, blend }] },
			primitive: { topology: 'triangle-list' },
		});
		// 縮小・拡大の各段階もrendererで指定された画像形式に揃える。
		const downsamplePipeline = makePipeline('downsample', INTERMEDIATE_TEXTURE_FORMAT);
		// Blend into the finer level in place; no second pyramid or detail sample.
		const blend: GPUBlendComponent = { srcFactor: 'constant', dstFactor: 'one-minus-constant' };
		const upsamplePipeline = makePipeline('upsample', INTERMEDIATE_TEXTURE_FORMAT, { color: blend, alpha: blend });
		const prefilterLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const prefilterGroup = device.createBindGroup({
			layout: prefilterLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
			],
		});
		const inputPipelineOptions = {
			device,
			vertex: context.defaultVertexShaderModule,
			code: blendCode + '\n' + commonCode + '\n' + inputCode,
			schema: { input: 'color' },
			sampling: 'level0',
		} as const;
		const prefilterStage = createFixedInputPipeline(params, context.resolution, {
			...inputPipelineOptions,
			internalLayouts: [prefilterLayout],
			entryPoint: 'prefilter',
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		const compositeStage = createFixedInputPipeline(params, context.resolution, {
			...inputPipelineOptions,
			internalLayouts: [bindGroupLayout],
			entryPoint: 'composite',
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
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
			colorAttachments: [{
				view,
				loadOp,
				storeOp: 'store',
				clearValue: [0, 0, 0, 0],
			}],
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
					format: INTERMEDIATE_TEXTURE_FORMAT,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				return { texture, view: texture.createView() };
			});
			return {
				workingSize,
				scaleX,
				scaleY,
				detailLevelCount,
				levels,
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
			if (inputGroup != null) pass.setBindGroup(1, inputGroup);
			pass.draw(3);
			pass.end();
		};

		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const workingSize = getWorkingSize(params.quality);
				const { radius, scaleX, scaleY } = getRadiusSettings(params.radius);
				const resized = workingSize !== pyramid.workingSize || scaleX !== pyramid.scaleX || scaleY !== pyramid.scaleY;
				if (resized) {
					for (const { texture } of pyramid.levels) texture.destroy();
					pyramid = makePyramid(workingSize, scaleX, scaleY);
					compositeGroup = makeBindGroup(pyramid.levels[0].view);
				}
				const { levels, downPasses, upPasses, downGroups, upGroups } = pyramid;
				const input = params.input;
				const strength = input.kind === 'uniform' && input.value.every(value => value === 0) ? 0 : clamp(params.strength, 5, 1);
				const outputSize = outputTexture;
				// 作業解像度の丸めや非等方な縮小でfitが変わらないよう、最終出力を基準にする。
				// 入力の1画素を出力の[-1, 1]座標へ逆変換し、抽出時のサンプル間隔にも同じfitを反映する。
				let prefilterOffset = [0, 0];
				if (input.kind === 'texture') {
					const scale = inputUvScale(input.resolution, outputSize, input.fitMode);
					prefilterOffset = [
						Math.max(0, 1 / levels[0].texture.width - 1 / (input.resolution.width * scale[0])),
						Math.max(0, 1 / levels[0].texture.height - 1 / (input.resolution.height * scale[1])),
					];
				}
				uniformValues.set({
					strength,
					inputBlendMode: colorBlendModes[params.inputBlendMode] ?? colorBlendModes.emission,
					radiusScale: [scaleX, scaleY],
					threshold: clamp(params.threshold, 1, 0.7),
					softKnee: clamp(params.softKnee, 1, 0.5),
					prefilterOffset,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				if (strength > 0) {
					draw(commandEncoder.beginRenderPass(downPasses[0]), prefilterStage.pipeline, prefilterGroup, prefilterStage.getBindGroup());
					if (radius > 0) {
						for (let i = 1; i < levels.length; i++) {
							draw(commandEncoder.beginRenderPass(downPasses[i]), downsamplePipeline, downGroups[i - 1]);
						}
						for (let i = levels.length - 2; i >= 0; i--) {
							const pass = commandEncoder.beginRenderPass(upPasses[i]);
							// 細部用の中間段階では光をそのまま拡大し、最上段でだけ細部と混ぜる。
							// 段階が増えてもRadiusが繰り返し掛かって光が弱まったり狭まったりしない。
							const weight = i === 0 || i > pyramid.detailLevelCount ? radius : 1;
							pass.setBlendConstant([weight, weight, weight, weight]);
							draw(pass, upsamplePipeline, upGroups[i]);
						}
					}
				}

				draw(beginOutputPass(commandEncoder, outputView), compositeStage.pipeline, compositeGroup, compositeStage.getBindGroup());
			},
			dispose: () => {
				prefilterStage.dispose();
				compositeStage.dispose();
				uniformBuffer.destroy();
				for (const { texture } of pyramid.levels) texture.destroy();
			},
		};
	},
};

export default implementation;
