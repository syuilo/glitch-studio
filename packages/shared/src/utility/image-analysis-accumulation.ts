// imageAnalysisSampleの重みは0〜1で、GPUでは65535倍した固定小数点として加算する。
// 65535 * 65537 = 0xffffffffなので、最悪の場合でも65537サンプルまでは直接加算できる。
export const MAX_IMAGE_ANALYSIS_DIRECT_SAMPLES = 65537;
export const IMAGE_ANALYSIS_SAMPLES_PER_CHUNK = 8192;

/** 内容に依存せず安全性を保証できる場合は、部分和と結果統合を生成しない。 */
export function getImageAnalysisChunkCount(maximumSamplesPerCounter: number): number {
	return maximumSamplesPerCounter <= MAX_IMAGE_ANALYSIS_DIRECT_SAMPLES ? 1 : Math.ceil(maximumSamplesPerCounter / IMAGE_ANALYSIS_SAMPLES_PER_CHUNK);
}
