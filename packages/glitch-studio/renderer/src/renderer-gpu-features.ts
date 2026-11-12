import type { EffectRenderTiling } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';

/** プレビュー・書き出しで共通のGPU機能要求。CPUだけの統計にはQueryを要求しない。 */
export function getRendererRequiredGpuFeatures(adapter: Pick<GPUAdapter, 'features'>, options: {
	enable32bitDataTextures: boolean;
	enableGpuStatistics?: boolean;
	effectRenderTiling?: EffectRenderTiling;
}): GPUFeatureName[] {
	const features: GPUFeatureName[] = [];
	if (options.enable32bitDataTextures) features.push('float32-filterable');
	// GPUDeviceには後からfeatureを追加できない。自動モードでは利用可能なら確保し、
	// 実際のtimestampWritesは長時間パスの対象だけで使う。非対応GPUは経過時間へ戻る。
	if (options.enableGpuStatistics === true || ((options.effectRenderTiling?.mode ?? 'auto') === 'auto' && adapter.features.has('timestamp-query'))) {
		features.push('timestamp-query');
	}
	return features;
}
