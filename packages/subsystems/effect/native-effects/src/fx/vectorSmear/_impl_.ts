import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { beginOutputPass, bindParameterValues, createFixedInputPipeline, intermediateTextureInput } from '../../multipass.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import encodeCode from './encode.shader.ts?shader';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const { input } = params;
		const displayTexture = input.kind === 'texture' ? device.createTexture({
			size: input.resolution, format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}) : null;
		const displayView = displayTexture?.createView();
		const encode = input.kind === 'texture' ? createFixedInputPipeline({ input: {
			kind: 'texture', resolution: input.resolution, get texture() { return input.texture; },
			fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest',
		} }, input.resolution, {
			device, vertex: defaultVertexShaderModule, code: encodeCode,
			schema: { input: 'color' }, targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }], sampling: 'level0',
		}) : null;
		const displayInput = input.kind === 'texture' ? intermediateTextureInput(displayTexture!, input) : input;
		const smear = createFixedInputPipeline({ input, displayInput, vector: params.vector, intensity: params.intensity, amount: params.amount }, context.resolution, {
			device, vertex: defaultVertexShaderModule, code,
			schema: { input: 'color', displayInput: 'color', vector: 'vector', intensity: 'scalar', amount: 'scalar' },
			internalLayouts: [layout], targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }], sampling: 'level0',
		});
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const { vectorOffset, jitter, seed } = params;
				if (![...vectorOffset, jitter, seed].every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) {
					throw new Error('Vector Smear requires finite offset, jitter and seed.');
				}
				if (encode != null && displayView != null) {
					// 補間後にsRGBへ変換すると白黒の境界が明るくなるため、
					// 補間前に各texelを表示色へ変換する。
					const pass = beginOutputPass(commandEncoder, displayView);
					pass.setPipeline(encode.pipeline);
					pass.setBindGroup(encode.inputGroup, encode.getBindGroup());
					pass.draw(3);
					pass.end();
				}
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(outputTexture), vectorOffset,
					jitter: Math.max(0, Math.min(1, jitter)), seed: Math.trunc(seed) >>> 0,
					inputIsTexture: input.kind === 'texture' ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const pass = beginOutputPass(commandEncoder, outputView);
				pass.setPipeline(smear.pipeline);
				pass.setBindGroup(0, group);
				pass.setBindGroup(smear.inputGroup, smear.getBindGroup());
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				encode?.dispose();
				smear.dispose();
				displayTexture?.destroy();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
