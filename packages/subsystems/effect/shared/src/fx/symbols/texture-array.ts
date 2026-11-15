import mipmapCode from './mipmap.wgsl?raw';

const mipmapPipelines = new WeakMap<GPUDevice, { pipeline: GPURenderPipeline; sampler: GPUSampler }>();

/** 内蔵PNG用のrgba8unorm配列だけを扱い、画像転送からWGSL解析器へ依存しない。 */
export function createSymbolTextureArray(device: GPUDevice, images: ImageBitmap[]): GPUTexture {
	const { width, height } = images[0];
	const mipLevelCount = 1 + Math.floor(Math.log2(Math.max(width, height)));
	const texture = device.createTexture({
		size: [width, height, images.length], mipLevelCount, format: 'rgba8unorm',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
	});
	try {
		for (const [layer, source] of images.entries()) {
			device.queue.copyExternalImageToTexture({ source }, { texture, origin: [0, 0, layer] }, [width, height]);
		}
		let resources = mipmapPipelines.get(device);
		if (resources == null) {
			const shader = device.createShaderModule({ code: mipmapCode });
			resources = {
				pipeline: device.createRenderPipeline({ layout: 'auto', vertex: { module: shader }, fragment: { module: shader, targets: [{ format: 'rgba8unorm' }] } }),
				sampler: device.createSampler({ minFilter: 'linear' }),
			};
			mipmapPipelines.set(device, resources);
		}
		const encoder = device.createCommandEncoder();
		for (let layer = 0; layer < images.length; layer++) {
			let source = texture.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
			for (let level = 1; level < mipLevelCount; level++) {
				const destination = texture.createView({ dimension: '2d', baseMipLevel: level, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 });
				const pass = encoder.beginRenderPass({ colorAttachments: [{ view: destination, loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(resources.pipeline);
				pass.setBindGroup(0, device.createBindGroup({ layout: resources.pipeline.getBindGroupLayout(0), entries: [
					{ binding: 0, resource: resources.sampler }, { binding: 1, resource: source },
				] }));
				pass.draw(3);
				pass.end();
				source = destination;
			}
		}
		device.queue.submit([encoder.finish()]);
		return texture;
	} catch (error) {
		texture.destroy();
		throw error;
	}
}
