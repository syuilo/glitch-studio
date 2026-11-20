import { createTextureFromSources } from 'webgpu-utils';
import { createSymbolTextureArray } from '../../src/fx/symbols/texture-array.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const reader = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d_array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(8, 8) fn read(@builtin(global_invocation_id) position: vec3u) {
  let size = textureDimensions(image);
  if (any(position.xy >= size)) { return; }
  let value = vec4u(round(textureLoad(image, vec2i(position.xy), position.z, 0) * 255.0));
  let index = ((position.z * size.y + position.y) * size.x + position.x) * 4u;
  output[index] = value.x; output[index + 1u] = value.y;
  output[index + 2u] = value.z; output[index + 3u] = value.w;
}` }) } });
	async function readMip(texture: GPUTexture, level: number) {
		const width = Math.max(1, texture.width >> level);
		const height = Math.max(1, texture.height >> level);
		const size = width * height * texture.depthOrArrayLayers * 16;
		const output = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
		const readback = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginComputePass();
			pass.setPipeline(reader);
			pass.setBindGroup(0, device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [
				{ binding: 0, resource: texture.createView({ dimension: '2d-array', baseMipLevel: level, mipLevelCount: 1 }) },
				{ binding: 1, resource: { buffer: output } },
			] }));
			pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), texture.depthOrArrayLayers);
			pass.end();
			encoder.copyBufferToBuffer(output, 0, readback, 0, size);
			device.queue.submit([encoder.finish()]);
			await readback.mapAsync(GPUMapMode.READ);
			return new Uint32Array(readback.getMappedRange()).slice();
		} finally {
			readback.destroy(); output.destroy();
		}
	}

	const checks: string[] = [];
	try {
		for (const [width, height] of [[16, 8], [13, 7], [1, 1]]) {
			const images: ImageBitmap[] = [];
			const textures: GPUTexture[] = [];
			try {
				for (let layer = 0; layer < 2; layer++) {
					const pixels = new Uint8ClampedArray(width * height * 4);
					for (let y = 0; y < height; y++) {
						for (let x = 0; x < width; x++) {
							pixels.set([(x * 23 + layer * 89) % 256, (y * 37) % 256, (x + y) % 2 * 255, (x + 2 * y) % 3 === 0 ? 96 : 255], (y * width + x) * 4);
						}
					}
					images.push(await createImageBitmap(new ImageData(pixels, width, height)));
				}
				const expected = createTextureFromSources(device, images, { mips: true });
				textures.push(expected);
				const actual = createSymbolTextureArray(device, images);
				textures.push(actual);
				if (actual.mipLevelCount !== expected.mipLevelCount) throw new Error('Mipmap count changed');
				for (let level = 0; level < actual.mipLevelCount; level++) {
					const previousPixels = await readMip(expected, level);
					const pixels = await readMip(actual, level);
					if (pixels.some((value, index) => Math.abs(value - previousPixels[index]) > 1)) {
						throw new Error(`Symbol mip pixels changed at ${width}x${height}, level ${level}`);
					}
					checks.push(`${width}x${height} mip ${level}: orientation, alpha and array layers`);
				}
			} finally {
				for (const texture of textures) texture.destroy();
				for (const image of images) image.close();
			}
		}
		const validation = await device.popErrorScope();
		if (validation != null) throw new Error(validation.message);
		return { checks };
	} finally {
		device.destroy();
	}
}
