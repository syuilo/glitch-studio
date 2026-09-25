import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, enable32bitDataTextures }, resolution }) => {
		const scale = Math.min(1, 256 / Math.max(resolution.width, resolution.height));
		const size = {
			width: Math.max(1, Math.round(resolution.width * scale)),
			height: Math.max(1, Math.round(resolution.height * scale)),
		};
		const module = device.createShaderModule({ code });
		const createPipeline = (entryPoint: string, format: GPUTextureFormat) => device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, entryPoint, targets: [{ format }] },
			primitive: { topology: 'triangle-list' },
		});
		const scalarFormat = enable32bitDataTextures ? 'r32float' : 'r16float';
		const vectorFormat = enable32bitDataTextures ? 'rg32float' : 'rg16float';
		const captureLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const capturePipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: captureCode,
			schema: { input: 'color' }, targets: [{ format: scalarFormat }],
			internalLayouts: [captureLayout], sampling: 'level0', entryPoint: 'capture',
		});
		const estimate = createPipeline('estimate', vectorFormat);
		const output = createPipeline('output', vectorFormat);
		const createTexture = (format: GPUTextureFormat) => device.createTexture({
			size, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const frames = [createTexture(scalarFormat), createTexture(scalarFormat)];
		const frameViews = frames.map(texture => texture.createView());
		const flow = createTexture(vectorFormat);
		const flowView = flow.createView();
		const values = new Float32Array(6);
		values.set([1 / size.width, 1 / size.height]);
		const uniforms = device.createBuffer({
			size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		// 内部の移動量の平滑化・拡大には、入力接続のwrap/filterを適用しない。
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		const uniformEntry = { binding: 0, resource: { buffer: uniforms } };
		const samplerEntry = { binding: 1, resource: sampler };
		const estimateGroups = frameViews.map((view, index) => device.createBindGroup({
			layout: estimate.getBindGroupLayout(0),
			entries: [uniformEntry, { binding: 3, resource: frameViews[1 - index] }, { binding: 4, resource: view }],
		}));
		const outputGroup = device.createBindGroup({
			layout: output.getBindGroupLayout(0),
			entries: [uniformEntry, samplerEntry, { binding: 5, resource: flowView }],
		});
		const captureGroup = device.createBindGroup({
			layout: captureLayout,
			entries: [uniformEntry],
		});
		let previousInputSettings: string | undefined;
		let current = 0;
		let hasPrevious = false;
		const attachment = (view: GPUTextureView): GPURenderPassDescriptor => ({
			colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
		});
		return {
			render: ctx => {
				const input = ctx.params.input;
				const inputSettings = input.kind === 'texture'
					? `${input.kind}:${input.fitMode}:${input.wrapMode}:${input.filterMode}`
					: input.kind;
				// 設定変更による見え方の差を動きと誤認しないよう、履歴を取り直す。
				// 上流がテクスチャを交互に出力しても追跡できるよう、オブジェクト同一性は比較しない。
				if (inputSettings !== previousInputSettings) hasPrevious = false;
				previousInputSettings = inputSettings;
				// A pause or invalid interval starts a new history instead of emitting a jump.
				if (!Number.isFinite(ctx.timeDelta) || ctx.timeDelta <= 0 || ctx.timeDelta > 250) hasPrevious = false;
				values.set([Math.max(0.001, ctx.timeDelta / 1000), Math.max(0, ctx.params.strength),
																Math.max(0.000001, ctx.params.confidence), Math.max(0, ctx.params.smoothing)], 2);
				device.queue.writeBuffer(uniforms, 0, values);
				// 履歴解像度の丸めに左右されず、最終出力に配置された画像の動きを測る。
				const capture = capturePipelines.update({ input }, ctx.outputDataMap.output.texture);
				const save = ctx.createPassEncoder(ctx.commandEncoder, attachment(frameViews[current]));
				save.setPipeline(capture.pipeline);
				save.setBindGroup(0, captureGroup);
				save.setBindGroup(capturePipelines.inputGroup, capture.bindGroup);
				save.draw(6);
				save.end();
				if (hasPrevious) {
					const solve = ctx.createPassEncoder(ctx.commandEncoder, attachment(flowView));
					solve.setPipeline(estimate);
					solve.setBindGroup(0, estimateGroups[current]);
					solve.draw(6);
					solve.end();
				}
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				if (hasPrevious) {
					render.setPipeline(output);
					render.setBindGroup(0, outputGroup);
					render.draw(6);
				}
				render.end();
				current = 1 - current;
				hasPrevious = true;
			},
			dispose: () => {
				capturePipelines.dispose();
				uniforms.destroy();
				for (const texture of frames) texture.destroy();
				flow.destroy();
			},
		};
	},
});
