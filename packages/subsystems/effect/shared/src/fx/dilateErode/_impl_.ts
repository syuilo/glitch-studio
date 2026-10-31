import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

type MorphologyIntermediateOutput = { texture: GPUTexture; textureView: GPUTextureView; input: ShaderInput };

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, resolution }) => {
		const device = wgpu.device;
		const format = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
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
		const createPipelines = () => createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { input: 'scalar' },
			targets: [{ format }],
			internalLayouts: [uniformLayout],
			sampling: 'level0',
		});
		// 入力参照のuniform bufferもpipelineヘルパーが所有する。
		// 元入力と中間結果で共有すると、後段のstretch/nearestが先頭パスのfit/wrap/filterを
		// 上書きしてしまう。中間段階同士は同じ寸法・設定なので共有できる。
		const inputPipelines = createPipelines();
		let intermediatePipelines: ReturnType<typeof createPipelines> | null = null;
		const intermediateOutputs: MorphologyIntermediateOutput[] = [];
		const getIntermediateOutput = (index: number): MorphologyIntermediateOutput => {
			let output = intermediateOutputs[index];
			if (output == null) {
				const texture = device.createTexture({
					size: resolution,
					format,
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				output = {
					texture,
					textureView: texture.createView(),
					// 中間結果は出力画素に揃った離散的な最大値・最小値。補間で新しい値を作らない。
					input: textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }),
				};
				intermediateOutputs[index] = output;
			}
			return output;
		};
		return {
			render: ctx => {
				// 端を延長するため、各軸の全画素を含む半径より先は結果が変わらない。
				const maximumRadius = Math.max(resolution.width, resolution.height) - 1;
				let remainingRadius = ctx.params.input.kind === 'uniform' ? 0 : Math.min(maximumRadius,
					Math.ceil(Math.max(0, ctx.params.radius) * getSizeReferenceLength(ctx.params.sizeReference, resolution)));
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
						ctx.params.operation === 'erode' ? 1 : 0, 0, 0, 0,
					], index * uniformStride / 4);
				}
				// 同じbufferを書き換えて各パスを記録すると、全パスが最後の値を読むことになる。
				// 一括転送した個別領域をdynamic offsetで選び、各段の半径を保持する。
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.buffer, 0, passRadii.length * uniformStride);
				let source = ctx.params.input;
				for (let index = 0; index < passRadii.length; index++) {
					const intermediate = index === passRadii.length - 1 ? null : getIntermediateOutput(index % 2);
					const output = intermediate ?? ctx.outputDataMap.output;
					const pipelines = index === 0 ? inputPipelines : (intermediatePipelines ??= createPipelines());
					const variant = pipelines.update({ input: source }, output.texture);
					const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
					pass.setPipeline(variant.pipeline);
					pass.setBindGroup(0, uniformGroup, [index * uniformStride]);
					pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
					pass.draw(6);
					pass.end();
					if (intermediate != null) source = intermediate.input;
				}
			},
			dispose: () => {
				inputPipelines.dispose();
				intermediatePipelines?.dispose();
				uniformBuffer.destroy();
				for (const output of intermediateOutputs) output.texture.destroy();
			},
		};
	},
});
