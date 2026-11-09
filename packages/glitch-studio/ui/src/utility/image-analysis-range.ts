import type { ImageValueRange } from '@gs/shared/utility/image-value-scale.ts';

export const IMAGE_ANALYSIS_RANGE_PRESETS = {
	zeroToOne: { label: '0 ~ +1', minimum: 0, maximum: 1 },
	minusOneToOne: { label: '−1 ~ +1', minimum: -1, maximum: 1 },
	minusOneToFour: { label: '−1 ~ +4', minimum: -1, maximum: 4 },
	minusHalfToHalf: { label: '−0.5 ~ +0.5', minimum: -0.5, maximum: 0.5 },
	minusTenToTen: { label: '−10 ~ +10', minimum: -10, maximum: 10 },
} as const;
export type ImageAnalysisRangePreset = keyof typeof IMAGE_ANALYSIS_RANGE_PRESETS | 'custom';

export function getImageAnalysisValueRange(preset: ImageAnalysisRangePreset, customRange: ImageValueRange): ImageValueRange {
	const { minimum, maximum } = preset === 'custom' ? customRange : IMAGE_ANALYSIS_RANGE_PRESETS[preset];
	return { minimum, maximum };
}
