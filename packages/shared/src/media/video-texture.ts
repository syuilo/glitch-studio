import { scaleResolution } from '../resolution.ts';
import type { Resolution } from '../resolution.ts';
import code from './video-texture.wgsl?raw';
import type { VideoSample } from 'mediabunny';
import { INTERMEDIATE_TEXTURE_FORMAT } from '../types.ts';
import { createExternalImageToLinearTextureConverter } from './external-image-texture.ts';

/** 借用する乗算済みlinear sRGB画像。非正方形ピクセルの表示比率は画素寸法と分ける。 */
export type VideoFrameTexture = { texture: GPUTexture; displayResolution: Readonly<Resolution> };

/** 動画の回転・表示寸法・描画倍率を、linear化した後の画像へ適用する。 */
export function createVideoTexture(device: GPUDevice) {
	const source = createVideoFrameTexture(device);
	const shader = device.createShaderModule({ code });
	const pipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: { module: shader, entryPoint: 'vs' },
		fragment: { module: shader, entryPoint: 'renderCopiedVideo', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
		primitive: { topology: 'triangle-list' },
	});
	const rotationBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
	let output: GPUTexture | null = null;
	return {
		upload(sample: VideoSample, resolutionScale = 1): GPUTexture {
			const frame = sample.toVideoFrame();
			try {
				const texture = source.upload(frame);
				const { width, height } = scaleResolution({ width: sample.displayWidth, height: sample.displayHeight }, resolutionScale);
				if (sample.rotation === 0 && width === texture.width && height === texture.height) {
					output?.destroy();
					output = null;
					return texture;
				}
				if (output == null || output.width !== width || output.height !== height) {
					output?.destroy();
					output = device.createTexture({ size: [width, height], format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
				}
				device.queue.writeBuffer(rotationBuffer, 0, new Uint32Array([sample.rotation / 90, 0, 0, 0]));
				const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
					{ binding: 1, resource: { buffer: rotationBuffer } }, { binding: 2, resource: texture.createView() }, { binding: 3, resource: sampler },
				] });
				const encoder = device.createCommandEncoder();
				const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, group);
				pass.draw(3);
				pass.end();
				device.queue.submit([encoder.finish()]);
				return output;
			} finally { frame.close(); }
		},
		dispose() {
			source.dispose();
			output?.destroy();
			output = null;
			rotationBuffer.destroy();
		},
	};
}

/** Player等から借りたVideoFrameを、補間前にlinear・乗算済みの通常テクスチャへ正規化する。 */
export function createVideoFrameTexture(device: GPUDevice) {
	let texture: GPUTexture | null = null;
	const converter = createExternalImageToLinearTextureConverter(device);
	return {
		upload(frame: VideoFrame): GPUTexture {
			const width = frame.visibleRect?.width ?? frame.codedWidth;
			const height = frame.visibleRect?.height ?? frame.codedHeight;
			if (texture == null || texture.width !== width || texture.height !== height) {
				texture?.destroy();
				texture = device.createTexture({ size: [width, height], format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
			}
			// 非正方形ピクセルの表示倍率もlinear化より前に適用しない。画素を複製せず
			// 表示寸法だけを上書きしたFrameを使い、表示比率は後段の画像変形へ委ねる。
			const nativeFrame = frame.displayWidth === width && frame.displayHeight === height ? frame : new VideoFrame(frame, { displayWidth: width, displayHeight: height });
			try { converter.copy(nativeFrame, texture); } finally { if (nativeFrame !== frame) nativeFrame.close(); }
			return texture;
		},
		dispose() {
			converter.dispose();
			texture?.destroy();
			texture = null;
		},
	};
}
