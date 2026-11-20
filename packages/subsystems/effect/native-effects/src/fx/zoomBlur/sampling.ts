export const MIN_ZOOM_BLUR_SAMPLES = 4;
export const MAX_ZOOM_BLUR_SAMPLES = 256;

export function getZoomBlurSampleCount(samples: number): number {
	return Math.max(MIN_ZOOM_BLUR_SAMPLES, Math.min(MAX_ZOOM_BLUR_SAMPLES, Math.round(samples)));
}

/** サンプル数の変更時だけ作り直し、画素ごとのGaussian・分散色の計算を避ける。 */
export function createZoomBlurTaps(sampleCount: number) {
	return Array.from({ length: sampleCount }, (_, index) => {
		const along = index / (sampleCount - 1);
		const gaussianPosition = along * 2 - 1;
		// 赤から紫までを滑らかな色相環の3/4周で近似する。これは演出用のRGB重みであり、
		// 光源の分光分布や色パラメータではないため、sRGBの変換は適用しない。
		const spectrum = [0, 4, 2].map(offset => {
			const channel = Math.min(1, Math.max(0, Math.abs((along * 0.75 * 6 + offset) % 6 - 3) - 1));
			return channel * channel * (3 - 2 * channel);
		});
		// シェーダーで各チャンネルの重みを正規化するため、表自体の正規化は不要。
		return { spectrum, gaussianWeight: Math.exp(-0.5 * gaussianPosition * gaussianPosition / 0.64) };
	});
}
