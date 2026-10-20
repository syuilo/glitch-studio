import { scaleResolution } from '../resolution.ts';
import code from './video-texture.wgsl?raw';
import type { VideoSample } from 'mediabunny';
import type { IntermediateTextureFormat } from '../types.ts';

const opaqueVideoFormats = new Set<VideoPixelFormat>(['I420', 'I422', 'I444', 'NV12', 'RGBX', 'BGRX']);

/** 動画の表示寸法に指定倍率を適用してGPUへ転送する。fitやレイヤーの変形は呼び出し側で行う。 */
export function createVideoTexture(device: GPUDevice, format: IntermediateTextureFormat) {
	const shader = device.createShaderModule({ code });
	const createPipeline = (entryPoint: string) => device.createRenderPipeline({
		layout: 'auto', vertex: { module: shader, entryPoint: 'vs' },
		fragment: { module: shader, entryPoint, targets: [{ format }] },
		primitive: { topology: 'triangle-list' },
	});
	const externalVideoPipeline = createPipeline('renderExternalVideo');
	const copiedVideoPipeline = createPipeline('renderCopiedVideo');
	const rotationBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const rotationValues = new Uint32Array(4);
	const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
	let texture: GPUTexture | null = null;
	let copiedFrameTexture: GPUTexture | null = null;
	let copiedFrameBindGroup: GPUBindGroup | null = null;
	const createTexture = (width: number, height: number) => device.createTexture({
		size: { width, height }, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
	});
	const clearCopiedFrame = () => {
		copiedFrameTexture?.destroy();
		copiedFrameTexture = null;
		copiedFrameBindGroup = null;
	};
	const draw = (encoder: GPUCommandEncoder, target: GPUTexture, pipeline: GPURenderPipeline, bindGroup: GPUBindGroup) => {
		const pass = encoder.beginRenderPass({ colorAttachments: [{
			view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0],
		}] });
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	};
	return {
		upload(sample: VideoSample, resolutionScale = 1): GPUTexture {
			const nativeResolution = {
				width: Math.max(1, Math.round(sample.displayWidth)),
				height: Math.max(1, Math.round(sample.displayHeight)),
			};
			const { width, height } = scaleResolution(nativeResolution, resolutionScale);
			if (texture == null || texture.width !== width || texture.height !== height) {
				texture?.destroy();
				texture = createTexture(width, height);
			}
			// toVideoFrame()の戻り値はsampleとは別の所有物。変換済みテクスチャだけを保持し、
			// デコーダーの出力面をキャッシュしない。例外時もこのフレームは必ず解放する。
			const frame = sample.toVideoFrame();
			try {
				const isOpaque = frame.format != null && opaqueVideoFormats.has(frame.format);
				const canCopyToOutput = !isOpaque && sample.rotation === 0 && width === frame.displayWidth && height === frame.displayHeight;
				if (isOpaque || canCopyToOutput) clearCopiedFrame();
				if (canCopyToOutput) {
					// 回転もサイズ変更もなければ原寸を直接出力へコピーし、追加描画を省く。
					device.queue.copyExternalImageToTexture({ source: frame }, { texture, colorSpace: 'srgb', premultipliedAlpha: true }, { width, height });
					return texture;
				}
				rotationValues[0] = sample.rotation / 90;
				device.queue.writeBuffer(rotationBuffer, 0, rotationValues);
				let pipeline: GPURenderPipeline;
				let bindGroup: GPUBindGroup;
				if (isOpaque) {
					pipeline = externalVideoPipeline;
					const externalTexture = device.importExternalTexture({ source: frame, colorSpace: 'srgb' });
					bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
						{ binding: 0, resource: externalTexture }, { binding: 1, resource: { buffer: rotationBuffer } }, { binding: 3, resource: sampler },
					] });
				} else {
					// ChromeにはRGBAのexternalTextureをpremultiply済みで返す経路があり、シェーダーで
					// 再乗算すると半透明が暗くなる。alphaを持ち得る形式と形式非公開のフレームは、
					// 明示的にpremultiplyして直接コピーする。補間前の変換なので透明画素の色も混ざらない。
					if (copiedFrameTexture == null || copiedFrameBindGroup == null || copiedFrameTexture.width !== frame.displayWidth || copiedFrameTexture.height !== frame.displayHeight) {
						clearCopiedFrame();
						copiedFrameTexture = createTexture(frame.displayWidth, frame.displayHeight);
						copiedFrameBindGroup = device.createBindGroup({ layout: copiedVideoPipeline.getBindGroupLayout(0), entries: [
							{ binding: 1, resource: { buffer: rotationBuffer } }, { binding: 2, resource: copiedFrameTexture.createView() }, { binding: 3, resource: sampler },
						] });
					}
					device.queue.copyExternalImageToTexture({ source: frame }, { texture: copiedFrameTexture, colorSpace: 'srgb', premultipliedAlpha: true }, { width: frame.displayWidth, height: frame.displayHeight });
					pipeline = copiedVideoPipeline;
					bindGroup = copiedFrameBindGroup!;
				}
				const encoder = device.createCommandEncoder();
				draw(encoder, texture, pipeline, bindGroup);
				// VideoFrameをcloseするとexternalTextureも失効する。参照するコマンドを先にsubmitし、
				// 後段は同じqueue上の通常テクスチャを読むため、ここでGPU完了待ちは追加しない。
				device.queue.submit([encoder.finish()]);
			} finally {
				frame.close();
			}
			return texture;
		},
		dispose() {
			texture?.destroy();
			texture = null;
			clearCopiedFrame();
			rotationBuffer.destroy();
		},
	};
}
