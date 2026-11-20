import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues, beginOutputPass, createFixedInputPipeline } from '../../multipass.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const historyLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
				{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			],
		});
		const inputOptions = {
			device,
			vertex: defaultVertexShaderModule,
			code,
			schema: { input: 'color' },
			sampling: 'level0',
			constants: { HALF_PRECISION: Number(!enable32bitDataTextures) },
		} as const;
		const difference = createFixedInputPipeline(params, resolution, {
			...inputOptions,
			internalLayouts: [historyLayout],
			entryPoint: 'difference',
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
		});
		// captureでは書き込み先の履歴を読み取りbindingに含めない。
		const emptyLayout = device.createBindGroupLayout({ entries: [] });
		const emptyGroup = device.createBindGroup({ layout: emptyLayout, entries: [] });
		const capture = createFixedInputPipeline(params, resolution, {
			...inputOptions,
			internalLayouts: [emptyLayout],
			entryPoint: 'capture',
			targets: [{ format: historyFormat }],
		});
		// シェーダー側でも同じ保存精度に丸め、静止画に量子化由来の差分が出ないようにする。
		const history = device.createTexture({
			size: resolution,
			format: historyFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const historyView = history.createView();
		const values = new ArrayBuffer(12);
		const integers = new Uint32Array(values);
		const floats = new Float32Array(values);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const historyGroup = device.createBindGroup({
			layout: historyLayout,
			entries: [
				{ binding: 0, resource: historyView },
				{ binding: 1, resource: { buffer: uniforms } },
			],
		});
		let hasPrevious = false;
		return {
			resetRenderHistory() { hasPrevious = false; },
			render: ctx => {
				// 未接続を表す透明な定数では、従来どおり出力と履歴状態をリセットする。
				if (params.input.kind === 'uniform' && params.input.value.every(value => value === 0)) {
					hasPrevious = false;
					beginOutputPass(ctx.commandEncoder, outputView).end();
					return;
				}
				integers[0] = params.mode === 'luminance' ? 1 : 0;
				floats[1] = Math.max(0, params.gain);
				floats[2] = Math.max(0, params.threshold);
				device.queue.writeBuffer(uniforms, 0, values);
				const render = beginOutputPass(ctx.commandEncoder, outputView);
				if (hasPrevious) {
					render.setPipeline(difference.pipeline);
					render.setBindGroup(0, historyGroup);
					render.setBindGroup(difference.inputGroup, difference.getBindGroup());
					render.draw(3);
				}
				render.end();
				// Save the input only after the previous input has been used for comparison.
				const save = ctx.commandEncoder.beginRenderPass({
					colorAttachments: [{
						view: historyView,
						clearValue: {
							r: 0,
							g: 0,
							b: 0,
							a: 1,
						},
						loadOp: 'clear',
						storeOp: 'store',
					}],
				});
				save.setPipeline(capture.pipeline);
				save.setBindGroup(0, emptyGroup);
				save.setBindGroup(capture.inputGroup, capture.getBindGroup());
				save.draw(3);
				save.end();
				hasPrevious = true;
			},
			dispose: () => {
				difference.dispose();
				capture.dispose();
				uniforms.destroy();
				history.destroy();
			},
		};
	},
};

export default implementation;
