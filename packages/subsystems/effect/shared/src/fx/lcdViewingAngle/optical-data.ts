import { SPECTRAL_MINIMUM_WAVELENGTH_NM, SPECTRAL_SAMPLE_COUNT, SPECTRAL_WAVELENGTH_STEP_NM } from '../../optics/spectral-samples.ts';

export const LIQUID_CRYSTAL_LAYER_COUNT = 48;
export const RESPONSE_SAMPLE_COUNT = 256;

export function createColorFilterSamples(): Float32Array {
	const samples = new Float32Array(SPECTRAL_SAMPLE_COUNT * 4);
	const totalTransmission = [0, 0, 0];
	// 特定の製品の実測値ではなく、有限の帯域幅を持つ理想RGBフィルター。
	// 単色の3波長だけで評価すると、位相の周期がそのまま不自然な色の縞になってしまう。
	const centers = [610, 545, 460];
	const standardDeviations = [25, 22, 20];
	for (let index = 0; index < SPECTRAL_SAMPLE_COUNT; index++) {
		const wavelength = SPECTRAL_MINIMUM_WAVELENGTH_NM + index * SPECTRAL_WAVELENGTH_STEP_NM;
		const integrationWeight = index === 0 || index === SPECTRAL_SAMPLE_COUNT - 1 ? 0.5 : 1;
		for (let channel = 0; channel < 3; channel++) {
			const normalizedDistance = (wavelength - centers[channel]) / standardDeviations[channel];
			const transmission = Math.exp(-0.5 * normalizedDistance * normalizedDistance) * integrationWeight;
			samples[index * 4 + channel] = transmission;
			totalTransmission[channel] += transmission;
		}
		samples[index * 4 + 3] = wavelength;
	}
	// 等エネルギーのバックライトを仮定する。各原色のフィルター面積・光源強度は
	// 正面の白で校正済みとし、ここでは各帯域の透過率の変化だけをlinear RGBへ適用する。
	for (let index = 0; index < SPECTRAL_SAMPLE_COUNT; index++) {
		for (let channel = 0; channel < 3; channel++) samples[index * 4 + channel] /= totalTransmission[channel];
	}
	return samples;
}
