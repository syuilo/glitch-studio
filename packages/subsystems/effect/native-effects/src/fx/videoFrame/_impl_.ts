import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createVideoTexture } from '@gs/shared/media/video-texture.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import { normalizeVideoTime } from './video-time.ts';
import { openVideoFrameSource } from './video-source.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, never, typeof definition.staticSettingDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures, resources } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const shaderModule = device.createShaderModule({ code });
		const pipeline = device.createRenderPipeline({
			vertex: { module: defaultVertexShaderModule },
			fragment: { module: shaderModule, targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
			primitive: { topology: 'triangle-list' },
			layout: 'auto',
		});
		const uniforms = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({
			size: uniforms.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		let sourceTexture: GPUTexture | null = null;
		let bindGroup: GPUBindGroup | null = null;
		const videoTexture = createVideoTexture(device);
		let source: ReturnType<typeof openVideoFrameSource> | null = null;
		let preparedPosition: number | null = null;
		let pending: Promise<void> | null = null;

		async function decode(position: number, signal: AbortSignal) {
			// 素材は配置に固定し、デコーダーは読み取りの失敗で破棄した場合だけ次の要求で開き直す。
			source ??= openVideoFrameSource(resources.asset!);
			const sample = await source.getSample(position).catch(error => {
				source?.dispose();
				source = null;
				throw error;
			});
			try {
				signal.throwIfAborted();
				// GPUへ同期的にコピーし、デコード済みサンプルは保持せずfinallyで解放する。
				const texture = sample == null ? null : videoTexture.upload(sample);
				if (texture !== sourceTexture) {
					bindGroup = texture == null ? null : device.createBindGroup({
						layout: pipeline.getBindGroupLayout(0), entries: [
							{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: sampler },
							{ binding: 2, resource: texture.createView() },
						],
					});
					sourceTexture = texture;
				}
				preparedPosition = position;
			} finally { sample?.close(); }
		}

		return {
			cacheKey: 0,
			prepare(_frame, signal) {
				const position = normalizeVideoTime(params.time, params.outOfRange);
				if (resources.asset == null || position === preparedPosition) return;
				if (position == null) {
					sourceTexture = null;
					bindGroup = null;
					preparedPosition = null;
					return;
				}
				// 同じデコーダーでのシークを直列化し、順番が来るまでに中断された要求は読み飛ばす。
				const run = () => { signal.throwIfAborted(); return decode(position, signal); };
				const task = pending == null ? run() : pending.then(run, run);
				pending = task;
				return task.finally(() => { if (pending === task) pending = null; });
			},
			render(ctx) {
				const pass = beginOutputPass(ctx.commandEncoder, outputView);
				if (sourceTexture != null && bindGroup != null) {
					uniforms.set({
						aspectRatio: resolution.width / resolution.height,
						sourceAspectRatio: sourceTexture.width / sourceTexture.height,
						mode: params.fit === 'cover' ? 1 : params.fit === 'contain' ? 2 : 0,
					});
					device.queue.writeBuffer(uniformBuffer, 0, uniforms.arrayBuffer);
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, bindGroup);
					pass.draw(3);
				}
				pass.end();
			},
			dispose: () => {
				source?.dispose();
				videoTexture.dispose();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
