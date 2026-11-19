import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { beginOutputPass, bindParameterValues, createFixedInputPipeline, intermediateTextureInput } from '../../multipass.ts';
import code from './shader.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { FixedShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const device = context.device;
		const format = context.enable32bitDataTextures ? 'r32float' : 'r16float';
		const uniformByteLength = 32;
		const uniformOffsetAlignment = device.limits.minUniformBufferOffsetAlignment;
		const uniformStride = Math.ceil(uniformByteLength / uniformOffsetAlignment) * uniformOffsetAlignment;
		const maximumPassCount = Math.ceil(Math.log2(Math.max(resolution.width, resolution.height))) + 1;
		const uniformValues = new Float32Array(uniformStride / 4 * maximumPassCount);
		const uniformBuffer = device.createBuffer({
			size: uniformValues.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const uniformLayout = device.createBindGroupLayout({
			entries: [{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uniformByteLength },
			}],
		});
		const uniformGroup = device.createBindGroup({
			layout: uniformLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer, size: uniformByteLength } }],
		});
		const createStage = (input: FixedShaderInput) => createFixedInputPipeline({ input }, resolution, {
			device,
			vertex: context.defaultVertexShaderModule,
			code,
			schema: { input: 'scalar' },
			targets: [{ format }],
			internalLayouts: [uniformLayout],
			sampling: 'level0',
		});
		// 入力参照のuniform bufferもpipelineヘルパーが所有する。
		// 元入力と中間結果で共有すると、後段のstretch/nearestが先頭パスのfit/wrap/filterを
		// 上書きしてしまう。中間段階同士は同じ寸法・設定なので共有できる。
		const inputStage = createStage(params.input);
		// 半径は動くが、必要になり得る中間段数は画像の寸法から決まる。
		const maximumPasses = Math.ceil(Math.log2(Math.max(resolution.width, resolution.height)));
		const intermediates = Array.from({ length: params.input.kind === 'texture' ? Math.min(2, Math.max(0, maximumPasses - 1)) : 0 }, () => {
			const texture = device.createTexture({ size: resolution, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			return { texture, view: texture.createView(), stage: createStage(intermediateTextureInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' })) };
		});
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				// 端を延長するため、各軸の全画素を含む半径より先は結果が変わらない。
				const maximumRadius = Math.max(resolution.width, resolution.height) - 1;
				let remainingRadius = params.input.kind === 'uniform' ? 0 : Math.min(maximumRadius,
					Math.ceil(Math.max(0, params.radius) * getSizeReferenceLength(params.sizeReference, resolution)));
				const passRadii: number[] = [];
				// 半径Rの正方形同士の形態演算を合成すると、半径は加算される。
				// 1, 2, 4, …と残りの半径を使えば、各段の3×3サンプルが覆う範囲に隙間がない。
				// 半径に比例するループや面積分のサンプルを避け、描画回数を対数に抑える。
				for (let stepRadius = 1; remainingRadius > 0; stepRadius *= 2) {
					const passRadius = Math.min(stepRadius, remainingRadius);
					passRadii.push(passRadius);
					remainingRadius -= passRadius;
				}
				if (passRadii.length === 0) passRadii.push(0);
				for (const [index, radius] of passRadii.entries()) {
					uniformValues.set([
						radius * 2 / resolution.width, radius * 2 / resolution.height,
						1 / resolution.width, 1 / resolution.height,
						params.operation === 'erode' ? 1 : 0, 0, 0, 0,
					], index * uniformStride / 4);
				}
				// 同じbufferを書き換えて各パスを記録すると、全パスが最後の値を読むことになる。
				// 一括転送した個別領域をdynamic offsetで選び、各段の半径を保持する。
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.buffer, 0, passRadii.length * uniformStride);
				for (let index = 0; index < passRadii.length; index++) {
					const stage = index === 0 ? inputStage : intermediates[(index - 1) % 2].stage;
					const view = index === passRadii.length - 1 ? outputView : intermediates[index % 2].view;
					const pass = beginOutputPass(commandEncoder, view);
					pass.setPipeline(stage.pipeline);
					pass.setBindGroup(0, uniformGroup, [index * uniformStride]);
					pass.setBindGroup(stage.inputGroup, stage.getBindGroup());
					pass.draw(3);
					pass.end();
				}
			},
			dispose: () => {
				inputStage.dispose();
				uniformBuffer.destroy();
				for (const { texture, stage } of intermediates) { texture.destroy(); stage.dispose(); }
			},
		};
	},
};

export default implementation;
