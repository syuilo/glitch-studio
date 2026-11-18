import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import encodeCode from './encode.shader.ts?shader';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule } }) => {
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const encodePipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code: encodeCode,
			schema: { input: 'color' }, targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }], sampling: 'level0',
		});
		const smearPipelines = createShaderInputPipeline({
			device, vertex: defaultVertexShaderModule, code,
			schema: { input: 'color', displayInput: 'color', vector: 'vector', intensity: 'scalar', amount: 'scalar' },
			internalLayouts: [layout], targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }], sampling: 'level0',
		});
		let displayTarget: { texture: GPUTexture; view: GPUTextureView } | null = null;
		return {
			render: ctx => {
				const { input, vector, intensity, amount, vectorOffset, jitter, seed } = ctx.params;
				if (![...vectorOffset, jitter, seed].every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
					throw new Error('Vector Smear requires finite offset, jitter and seed.');
				}
				let displayInput = input;
				if (input.kind === 'texture') {
					// 補間後にsRGBへ変換すると黒白の境界が明るくなる。入力の各texelを
					// 先に表示色へ変換し、元の寸法・Fit/Wrap/Filterを保ったまま9点を読む。
					const { width, height } = input.texture;
					if (displayTarget == null || displayTarget.texture.width !== width || displayTarget.texture.height !== height) {
						displayTarget?.texture.destroy();
						const texture = device.createTexture({ size: { width, height }, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
						displayTarget = { texture, view: texture.createView() };
					}
					const encoded = encodePipelines.update({ input: textureShaderInput(input.texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }) }, displayTarget.texture);
					const encodePass = ctx.createPassEncoderFor(ctx.commandEncoder, displayTarget.view);
					encodePass.setPipeline(encoded.pipeline);
					encodePass.setBindGroup(encodePipelines.inputGroup, encoded.bindGroup);
					encodePass.draw(3);
					encodePass.end();
					displayInput = textureShaderInput(displayTarget.texture, input);
				} else {
					displayTarget?.texture.destroy();
					displayTarget = null;
				}
				const output = ctx.outputDataMap.output;
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(output.texture), vectorOffset,
					jitter: Math.max(0, Math.min(1, jitter)), seed: Math.trunc(seed) >>> 0,
					inputIsTexture: input.kind === 'texture' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const variant = smearPipelines.update({ input, displayInput, vector, intensity, amount }, output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(smearPipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				encodePipelines.dispose();
				smearPipelines.dispose();
				displayTarget?.texture.destroy();
				uniformBuffer.destroy();
			},
		};
	},
});
