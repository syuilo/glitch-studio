import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createNativeEffectInputBindings } from '../../shader-input.ts';
import code, { uniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init({ device, resolution, inputs, outputTextures, defaultVertexShaderModule }, publishOutputTextures) {
		const output = outputTextures.get('output')!;
		const publish = publishOutputTextures.get('output')!;
		const values = createShaderBuffer(uniforms.params);
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
		] });
		// シェーダーでは入力を加える分岐の中で入力を読むため、LODを明示する。
		const inputBindings = createNativeEffectInputBindings({ device, resolution, schema: { input: 'any' }, inputs, group: 1, sampling: 'level0' });
		let buffer: GPUBuffer | null = null;
		let alternate: GPUTexture | null = null;

		function dispose(): void {
			inputBindings.dispose();
			buffer?.destroy();
			alternate?.destroy();
		}

		try {
			const pipeline = await device.createRenderPipelineAsync({
				layout: device.createPipelineLayout({ bindGroupLayouts: [layout, inputBindings.layout] }),
				vertex: { module: defaultVertexShaderModule },
				fragment: {
					module: device.createShaderModule({ code: inputBindings.code + '\n' + code }), entryPoint: 'fs',
					constants: { MAX_VALUE: output.format === 'rgba32float' ? 3.402823466e38 : 65504 }, targets: [{ format: output.format }],
				},
			});
			const uniformBuffer = device.createBuffer({ size: values.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			buffer = uniformBuffer;
			alternate = device.createTexture({ size: resolution, format: output.format, usage: output.usage });
			const textures = [output, alternate];
			const views = textures.map(texture => texture.createView());
			// 2通りの読み書きを初期化時に組む。前フレームと描画先は必ず別画像で、コピーせず描画直後に公開する。
			const targets = textures.map((texture, index) => ({
				texture,
				descriptor: { colorAttachments: [{ view: views[index], loadOp: 'clear', storeOp: 'store' }] } satisfies GPURenderPassDescriptor,
				group: device.createBindGroup({ layout, entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: views[1 - index] },
				] }),
			}));
			let nextTarget = 1;
			let history: 'initial' | 'ready' | 'reset' = 'initial';
			return {
				render({ commandEncoder, timeDelta }) {
					// 履歴リセット前の経過時間を新しい蓄積に数えない。通常の初回描画には呼び出し側の時間を使う。
					const seconds = history !== 'reset' && Number.isFinite(timeDelta) ? Math.max(0, timeDelta) / 1000 : 0;
					const halfLife = Math.max(0, inputs.halfLife.value) / 1000;
					// 半減期0では履歴を即時に減衰させ、加算による蓄積は0、補間は現在の入力に追従する。
					let decay = 0;
					let interpolation = 1;
					let integration = 0;
					if (halfLife > 0) {
						// 加算は dA/dt = strength * input - rate * A、補間は dA/dt = rate * (strength * input - A)。
						// それぞれをフレーム間の経過時間で積分する。
						const exponent = Math.LN2 * seconds / halfLife;
						decay = Math.exp(-exponent);
						// 短いフレーム間隔でも桁落ちさせず、区間を分割しても同じ量の入力を積分する。
						interpolation = -Math.expm1(-exponent);
						integration = exponent > 0 ? interpolation * halfLife / Math.LN2 : seconds;
					}
					// 補間の開始時には比較する履歴がないため、Strength適用後の現在の入力から始める。
					const weight = inputs.mode.value === 'interpolate' ? (history === 'ready' ? interpolation : 1) : integration;
					const reset = inputs.reset.value;
					values.set({ decay: history === 'ready' && !reset ? decay : 0, inputWeight: reset ? 0 : weight * Math.max(0, inputs.strength.value) });
					device.queue.writeBuffer(uniformBuffer, 0, values.arrayBuffer);
					const inputGroup = inputBindings.getBindGroup();
					const target = targets[nextTarget];
					const pass = commandEncoder.beginRenderPass(target.descriptor);
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, target.group);
					pass.setBindGroup(1, inputGroup);
					pass.draw(3);
					pass.end();
					publish(target.texture);
					nextTarget = 1 - nextTarget;
					history = 'ready';
				},
				resetRenderHistory() { history = 'reset'; },
				dispose,
			};
		} catch (error) {
			dispose();
			throw error;
		}
	},
};

export default implementation;
