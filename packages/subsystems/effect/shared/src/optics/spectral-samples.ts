// 380〜780nmを5nm刻みで積分する。RGBの3波長だけで評価すると光路差を変えたときの
// 色の繰り返しが強く出るため、可視域の応答を合算して干渉色を求める。
export const SPECTRAL_SAMPLE_COUNT = 81;

function asymmetricGaussian(wavelength: number, center: number, leftScale: number, rightScale: number): number {
	const normalizedDistance = (wavelength - center) * (wavelength < center ? leftScale : rightScale);
	return Math.exp(-0.5 * normalizedDistance * normalizedDistance);
}

export function createSpectralSamples(): Float32Array {
	const samples = new Float32Array(SPECTRAL_SAMPLE_COUNT * 4);
	const whiteResponse = [0, 0, 0];
	for (let index = 0; index < SPECTRAL_SAMPLE_COUNT; index++) {
		const wavelength = 380 + index * 5;
		// Wyman・Sloan・Shirley (2013) の式(4)・表1によるCIE 1931等色関数の近似。
		// 数値係数をCPUで評価し、画素ごとに同じGaussianを再計算しない。
		// https://jcgt.org/published/0002/02/01/
		const x = 0.362 * asymmetricGaussian(wavelength, 442, 0.0624, 0.0374)
			+ 1.056 * asymmetricGaussian(wavelength, 599.8, 0.0264, 0.0323)
			- 0.065 * asymmetricGaussian(wavelength, 501.1, 0.049, 0.0382);
		const y = 0.821 * asymmetricGaussian(wavelength, 568.8, 0.0213, 0.0247)
			+ 0.286 * asymmetricGaussian(wavelength, 530.9, 0.0613, 0.0322);
		const z = 1.217 * asymmetricGaussian(wavelength, 437, 0.0845, 0.0278)
			+ 0.681 * asymmetricGaussian(wavelength, 459, 0.0385, 0.0725);
		// 台形則の端点だけ半分にする。共通の波長刻み幅は白色の正規化で相殺される。
		const integrationWeight = index === 0 || index === SPECTRAL_SAMPLE_COUNT - 1 ? 0.5 : 1;
		const linearRgbWeights = [
			3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
			-0.969266 * x + 1.8760108 * y + 0.041556 * z,
			0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
		];
		for (let channel = 0; channel < 3; channel++) {
			const weight = linearRgbWeights[channel] * integrationWeight;
			samples[index * 4 + channel] = weight;
			whiteResponse[channel] += weight;
		}
		samples[index * 4 + 3] = wavelength;
	}
	// 等エネルギー光を白として扱うため、各RGB成分の全波長応答を1へ正規化する。
	// Light Colorはこの白に対するRGBの着色であり、光源の分光分布そのものは再構築しない。
	for (let index = 0; index < SPECTRAL_SAMPLE_COUNT; index++) {
		for (let channel = 0; channel < 3; channel++) samples[index * 4 + channel] /= whiteResponse[channel];
	}
	return samples;
}
