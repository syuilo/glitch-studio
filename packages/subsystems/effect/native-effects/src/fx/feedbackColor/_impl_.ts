import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createNativeEffectInputBindings } from '../../shader-input.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init({ device, resolution, inputs, outputTextures, defaultVertexShaderModule, enable32bitDataTextures }) {
		const output = outputTextures.get('output')!;
		const historyFormat = enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		const bindings = createNativeEffectInputBindings({ device, resolution, group: 1,
			schema: { input: 'color', strengthFactor: 'color', halfLifeFactor: 'color' }, inputs });
		const history: GPUTexture[] = [];
		let buffer: GPUBuffer | null = null;

		function dispose() {
			bindings.dispose();
			for (const texture of history) texture.destroy();
			buffer?.destroy();
		}

		try {
			const pipeline = await device.createRenderPipelineAsync({
				layout: device.createPipelineLayout({ bindGroupLayouts: [layout, bindings.layout] }),
				vertex: { module: defaultVertexShaderModule },
				fragment: { module: device.createShaderModule({ code: bindings.code + '\n' + code }),
					// 画像出力はrgba16floatなので、履歴側の精度にかかわらずhalfの有限な値域に収める。
					constants: { MAX_VALUE: enable32bitDataTextures ? 3.402823466e38 : 65504, MAX_OUTPUT_VALUE: 65504 },
					targets: [{ format: output.format }, { format: historyFormat }] },
			});
			const values = new Float32Array(5);
			const uniforms = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			buffer = uniforms;
			// alphaが0でもRGBが残る履歴を、公開する乗算済みRGBAとは別に保持する。
			for (let i = 0; i < 2; i++) history.push(device.createTexture({ size: resolution, format: historyFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }));
			const views = history.map(texture => texture.createView());
			const outputView = output.createView();
			const targets = views.map((view, index) => ({
				group: device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniforms } }, { binding: 1, resource: views[1 - index] }] }),
				descriptor: { colorAttachments: [outputView, view].map(view => ({ view, loadOp: 'clear', storeOp: 'store' })) } satisfies GPURenderPassDescriptor,
			}));
			let next = 0;
			let state: 'initial' | 'ready' | 'reset' = 'initial';
			return {
				render({ commandEncoder, timeDelta }) {
					values[0] = state !== 'reset' && Number.isFinite(timeDelta) ? Math.max(0, timeDelta / 1000) : 0;
					values[1] = inputs.reset.value ? 0 : Math.max(0, inputs.strength.value);
					values[2] = Math.max(0, inputs.halfLife.value) / 1000;
					values[3] = state === 'ready' && !inputs.reset.value ? 1 : 0;
					values[4] = inputs.mode.value === 'interpolate' ? 1 : 0;
					// 入力の色で係数が画素ごとに変わるため、積分と減衰の計算はシェーダーで行う。
					device.queue.writeBuffer(uniforms, 0, values);
					const group = bindings.getBindGroup();
					const pass = commandEncoder.beginRenderPass(targets[next].descriptor);
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, targets[next].group);
					pass.setBindGroup(1, group);
					pass.draw(3);
					pass.end();
					state = 'ready';
					next = 1 - next;
				},
				resetRenderHistory() { state = 'reset'; },
				dispose,
			};
		} catch (error) {
			dispose();
			throw error;
		}
	},
};

export default implementation;
