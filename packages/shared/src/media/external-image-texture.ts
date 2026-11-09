import { INTERMEDIATE_TEXTURE_FORMAT } from '../types.ts';
import colorSpaceShaderCode from '../gpu/color-space.wgsl?raw';
import vertexShaderCode from '../gpu/vertex.wgsl?raw';
import shaderCode from './external-image-texture.wgsl?raw';

/** 通常の画像・alpha付き動画を、原寸の乗算済みlinear sRGBへ変換する。素材や時計は所有しない。 */
export function createExternalImageToLinearTextureConverter(device: GPUDevice) {
	const pipeline = device.createRenderPipeline({
		label: 'normalize external image to linear sRGB',
		layout: 'auto',
		vertex: { module: device.createShaderModule({ code: vertexShaderCode }) },
		fragment: { module: device.createShaderModule({ code: colorSpaceShaderCode + '\n' + shaderCode }), entryPoint: 'fs', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
		primitive: { topology: 'triangle-list' },
	});
	let staging: GPUTexture | null = null;
	let bindGroup: GPUBindGroup | null = null;
	return {
		copy(source: GPUCopyExternalImageSource, target: GPUTexture) {
			if (staging == null || staging.width !== target.width || staging.height !== target.height) {
				staging?.destroy();
				staging = device.createTexture({
					size: [target.width, target.height],
					format: INTERMEDIATE_TEXTURE_FORMAT,
					usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
				});
				bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: staging.createView() }] });
			}
			// Chrome 156ではalpha付きVideoFrameをsrgb-linearへ直接コピーすると、
			// encoded RGBのpremultiply後に伝達関数を適用する経路がある。sRGBへコピーして
			// 明示的にunpremultiply→linear化→premultiplyし、順序を実装側で保証する。
			device.queue.copyExternalImageToTexture({ source }, { texture: staging, colorSpace: 'srgb', premultipliedAlpha: true }, [target.width, target.height]);
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup!);
			pass.draw(3);
			pass.end();
			device.queue.submit([encoder.finish()]);
		},
		dispose() {
			staging?.destroy();
			staging = null;
			bindGroup = null;
		},
	};
}
