import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { bindParameterValues, beginOutputPass, createFixedInputPipeline } from '../../multipass.ts';
import code from './shader.wgsl?raw';
import captureCode from './capture.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
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
		const captureLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const capturePipelines = createFixedInputPipeline(params, resolution, {
			device,
			vertex: defaultVertexShaderModule,
			code: captureCode,
			schema: { input: 'color' },
			targets: [{ format: scalarFormat }],
			internalLayouts: [captureLayout],
			sampling: 'level0',
			entryPoint: 'capture',
		});
		const estimate = createPipeline('estimate', vectorFormat);
		const output = createPipeline('output', vectorFormat);
		const createTexture = (format: GPUTextureFormat) => device.createTexture({
			size,
			format,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const frames = [createTexture(scalarFormat), createTexture(scalarFormat)];
		const frameViews = frames.map(texture => texture.createView());
		const flow = createTexture(vectorFormat);
		const flowView = flow.createView();
		const values = new Float32Array(8);
		values.set([1 / size.width, 1 / size.height, resolution.width / Math.max(resolution.width, resolution.height), resolution.height / Math.max(resolution.width, resolution.height)]);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		// 内部の移動量の平滑化・拡大には、入力接続のwrap/filterを適用しない。
		const sampler = device.createSampler({
			minFilter: 'linear',
			magFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
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
		let current = 0;
		let hasPrevious = false;
		const attachment = (view: GPUTextureView): GPURenderPassDescriptor => ({
			colorAttachments: [{
				view,
				clearValue: {
					r: 0,
					g: 0,
					b: 0,
					a: 0,
				},
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		return {
			resetRenderHistory() {
				hasPrevious = false;
				current = 0;
			},
			render: ctx => {
				// 設定変更による見え方の差を動きと誤認しないよう、履歴を取り直す。
				// 上流がテクスチャを交互に出力しても追跡できるよう、オブジェクト同一性は比較しない。
				// A pause or invalid interval starts a new history instead of emitting a jump.
				if (!Number.isFinite(ctx.timeDelta) || ctx.timeDelta <= 0 || ctx.timeDelta > 250) hasPrevious = false;
				values.set([Math.max(0.001, ctx.timeDelta / 1000), Math.max(0, params.strength),
																Math.max(0.000001, params.confidence), Math.max(0, params.smoothing)], 4);
				device.queue.writeBuffer(uniforms, 0, values);
				// 履歴解像度の丸めに左右されず、最終出力に配置された画像の動きを測る。
				const capture = capturePipelines;
				const save = ctx.commandEncoder.beginRenderPass(attachment(frameViews[current]));
				save.setPipeline(capture.pipeline);
				save.setBindGroup(0, captureGroup);
				save.setBindGroup(capturePipelines.inputGroup, capture.getBindGroup());
				save.draw(3);
				save.end();
				if (hasPrevious) {
					const solve = ctx.commandEncoder.beginRenderPass(attachment(flowView));
					solve.setPipeline(estimate);
					solve.setBindGroup(0, estimateGroups[current]);
					solve.draw(3);
					solve.end();
				}
				const render = beginOutputPass(ctx.commandEncoder, outputView);
				if (hasPrevious) {
					render.setPipeline(output);
					render.setBindGroup(0, outputGroup);
					render.draw(3);
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
};

export default implementation;
