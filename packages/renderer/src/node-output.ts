import { textureShaderInput } from '@glitch/shared/shader-input.ts';
import { float32ToFloat16Bits } from '@glitch/shared/utility/float32ToFloat16Bits.ts';
import type { ShaderInput } from '@glitch/shared/shader-input.ts';
import type { NodeOutputReference } from '@glitch/shared/types.ts';

// 出力値は接続先のサンプリング設定を持たない。色は既にpremultiply済み。
export type NodeOutput = Extract<ShaderInput, { kind: 'uniform' }> | { kind: 'texture'; texture: GPUTexture };

export function outputShaderInput(output: NodeOutput, reference: Pick<NodeOutputReference, 'fitMode' | 'wrapMode' | 'filterMode'> = {}): ShaderInput {
	if (output.kind === 'texture') return textureShaderInput(output.texture, reference);
	// r/rgテクスチャを別の型の入力へ接続した場合と同じ、欠けた成分=(0, 0, 1)。
	// 受け取り側の型でpremultiplyし直すと色が二重乗算されるため、そのまま渡す。
	return { kind: 'uniform', value: [output.value[0] ?? 0, output.value[1] ?? 0, output.value[2] ?? 0, output.value[3] ?? 1] };
}

/**
 * 表示・集計などGPUTextureが必須の境界だけで使う。借用したテクスチャは所有しない。
 * 定数用は再利用するため、返したテクスチャを読むコマンドをsubmitしてから次のresolveを呼ぶ。
 */
export class OutputTextureResolver {
	private constants = new Map<number, { texture: GPUTexture; values: readonly number[] }>();

	constructor(private device: GPUDevice, private enable32bitDataTextures: boolean) {}

	resolve(output: NodeOutput): GPUTexture {
		if (output.kind === 'texture') return output.texture;
		const components = output.value;
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
