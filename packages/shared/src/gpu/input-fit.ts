export type InputFitMode = 'stretch' | 'cover' | 'contain';

/** 出力座標から入力座標へのfit補正。寸法だけを扱い、GPU・シェーダー生成に依存しない。 */
export function inputUvScale(input: { width: number; height: number }, output: { width: number; height: number }, fit: InputFitMode): readonly [number, number] {
	const ratio = (input.width / input.height) / (output.width / output.height);
	if (fit === 'cover') return [Math.min(1, 1 / ratio), Math.min(1, ratio)];
	if (fit === 'contain') return [Math.max(1, 1 / ratio), Math.max(1, ratio)];
	return [1, 1];
}
