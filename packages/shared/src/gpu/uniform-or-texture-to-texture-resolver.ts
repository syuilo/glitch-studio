import { float32ToFloat16Bits } from '../utility/float32ToFloat16Bits.ts';
import type { UniformOrTexture } from './uniform-or-texture.ts';

/**
 * 表示・集計などGPUTextureが必須の境界だけで使う。借用したテクスチャは所有しない。
 * 定数用は再利用するため、返したテクスチャを読むコマンドをsubmitしてから次のresolveを呼ぶ。
 */
export class UniformOrTextureToTextureResolver {
	private constants = new Map<number, { texture: GPUTexture; values: readonly number[] }>();

	constructor(private device: GPUDevice, private enable32bitDataTextures: boolean) {}

	resolve(source: UniformOrTexture): GPUTexture {
		if (source.kind === 'texture') return source.texture;
		const components = source.value;
		let cached = this.constants.get(components.length);
		if (cached == null) {
			const channels = components.length === 4 ? 'rgba' : components.length === 2 ? 'rg' : 'r';
			cached = { texture: this.device.createTexture({
				size: [1, 1],
				format: `${channels}${this.enable32bitDataTextures ? '32float' : '16float'}` as GPUTextureFormat,
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			}), values: [] };
			this.constants.set(components.length, cached);
		}
		if (!components.every((value, i) => Object.is(value, cached.values[i]))) {
			const data = this.enable32bitDataTextures ? new Float32Array(components) : new Uint16Array(components.map(float32ToFloat16Bits));
			this.device.queue.writeTexture({ texture: cached.texture }, data, { bytesPerRow: data.byteLength }, [1, 1]);
			cached.values = [...components];
		}
		return cached.texture;
	}

	dispose() {
		for (const { texture } of this.constants.values()) texture.destroy();
		this.constants.clear();
	}
}
