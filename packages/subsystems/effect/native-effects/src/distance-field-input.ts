import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectImageInput } from '@gs/subsystems_effect_renderer/effect-instance.ts';

/** SDFの0は輪郭を表す。透明な余白では端の距離を延長し、領域の境界をシェーダーで別に適用する。 */
export function distanceFieldInput(input: EffectImageInput, resolution: Resolution) {
	const size = input.kind === 'texture' ? input.resolution : null;
	const sampling = input.kind === 'texture' ? input.sampling : null;
	const transparent = sampling?.wrapMode === 'transparent';
	const binding: EffectImageInput = input.kind === 'texture' && transparent ? {
		kind: 'texture', resolution: input.resolution, sampling: { ...sampling, wrapMode: 'clamp' },
		get texture() { return input.texture; },
	} : input;
	return { binding, size, transparent, nearest: sampling?.filterMode === 'nearest',
		scale: size == null ? [1, 1] as const : inputUvScale(size, resolution, sampling?.fitMode ?? 'cover') };
}
