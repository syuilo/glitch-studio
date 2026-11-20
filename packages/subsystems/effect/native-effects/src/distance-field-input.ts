import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

/** SDFの0は輪郭を表す。透明な余白では端の距離を延長し、領域の境界をシェーダーで別に適用する。 */
export function distanceFieldInput(input: ShaderInput, resolution: Resolution) {
	if (input.kind === 'uniform') return { binding: input, size: null, transparent: false, nearest: false, scale: [1, 1] as const };
	const { resolution: size, sampling } = input;
	const transparent = sampling.wrapMode === 'transparent';
	const binding: ShaderInput = transparent ? {
		kind: 'texture', resolution: size, sampling: { ...sampling, wrapMode: 'clamp' },
		get texture() { return input.texture; },
	} : input;
	return { binding, size, transparent, nearest: sampling.filterMode === 'nearest',
		scale: inputUvScale(size, resolution, sampling.fitMode) };
}
