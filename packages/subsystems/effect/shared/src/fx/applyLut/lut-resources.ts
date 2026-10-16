import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import type { CubeLut, CubeLutTable } from './cube.ts';

export function createLutLayout(device: GPUDevice): GPUBindGroupLayout {
	return device.createBindGroupLayout({ entries: [
		{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
		{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } },
		{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
	] });
}

/** LUTは画像ではなく数値表。画像の保存形式・色空間・premultiplyは適用しない。 */
export function createLutResources(device: GPUDevice, layout: GPUBindGroupLayout, use32bit: boolean, lut: CubeLut | null) {
	const textures: GPUTexture[] = [];
	let buffer: GPUBuffer | null = null;
	const dispose = () => {
		for (const texture of textures) texture.destroy();
		buffer?.destroy();
	};
	try {
		const one = lut?.oneDimensional ?? null;
		const three = lut?.threeDimensional ?? null;
		// 65536点の1D LUTはGPUの1辺の上限を超え得るので、行に分けて格納する。
		// WGSL側で隣接する2点を明示して読むため、行境界で別の色が混ざらない。
		const width1d = Math.min(one?.size ?? 1, device.limits.maxTextureDimension2D);
		const height1d = Math.ceil((one?.size ?? 1) / width1d);
		if (height1d > device.limits.maxTextureDimension2D || (three?.size ?? 1) > device.limits.maxTextureDimension3D) {
			throw new Error('LUT dimensions exceed this GPU device limit.');
		}
		const upload = (table: CubeLutTable | null, size: [number, number, number], dimension: GPUTextureDimension) => {
			const count = size[0] * size[1] * size[2] * 4;
			const data = use32bit ? new Float32Array(count) : new Uint16Array(count);
			if (table != null) {
				for (let index = 0; index < table.values.length; index++) {
					const value = table.values[index];
					if (!use32bit && Math.abs(value) > 65504) throw new Error('LUT values exceed 16-bit float range. Enable 32-bit data textures.');
					data[index] = use32bit ? value : float32ToFloat16Bits(value);
				}
			}
			const texture = device.createTexture({
				size, dimension, format: use32bit ? 'rgba32float' : 'rgba16float',
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			textures.push(texture);
			device.queue.writeTexture({ texture }, data, { bytesPerRow: size[0] * 4 * data.BYTES_PER_ELEMENT, rowsPerImage: size[1] }, size);
			return texture.createView();
		};
		const oneView = upload(one, [width1d, height1d, 1], '2d');
		const side = three?.size ?? 1;
		const threeView = upload(three, [side, side, side], '3d');
		// WGSLのvec4単位で揃える。サイズ0はその段階を適用しない指定。
		const uniforms = new Float32Array([
			...(one?.min ?? [0, 0, 0]), 0, ...(one?.max ?? [1, 1, 1]), 0,
			...(three?.min ?? [0, 0, 0]), 0, ...(three?.max ?? [1, 1, 1]), 0,
			one?.size ?? 0, three?.size ?? 0, width1d, 0,
		]);
		buffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(buffer, 0, uniforms);
		const sampler = device.createSampler({
			addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge',
			minFilter: 'linear', magFilter: 'linear',
		});
		const bindGroup = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer } },
			{ binding: 1, resource: oneView },
			{ binding: 2, resource: threeView },
			{ binding: 3, resource: sampler },
		] });
		return { bindGroup, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}
