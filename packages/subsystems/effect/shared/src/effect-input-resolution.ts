import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

/** 最大画素数の入力の寸法を返す。同数では先頭を優先し、入力にない縦横比を作らない。 */
export function getLargestInputResolution(inputs: readonly ShaderInput[]): Resolution | undefined {
	let largest: Resolution | undefined;
	for (const input of inputs) {
		// 定数には固有の解像度がない。テクスチャが一つもなければ描画先の寸法へ委ねる。
		if (input.kind !== 'texture') continue;
		const { width, height } = input.texture;
		if (largest == null || width * height > largest.width * largest.height) {
			largest = { width, height };
		}
	}
	// 上流で既にプレビュー倍率が適用された計算用寸法なので、ここでは倍率を掛けない。
	return largest;
}
