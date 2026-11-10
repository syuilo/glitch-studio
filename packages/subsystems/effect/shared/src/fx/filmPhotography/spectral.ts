// このエフェクトの分光量はXYZへ積分する。既存の干渉色用ヘルパーは等エネルギー光を
// RGBの白へ正規化しているため、フィルムの感度・吸収の積分重みには流用しない。
export type Triple = [number, number, number];
export type Spectrum = readonly number[];
export const WAVELENGTHS = Array.from({ length: 81 }, (_, index) => 380 + 5 * index);
export const RGB_TO_XYZ = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]] as const;
export const XYZ_TO_RGB = [[3.2404542, -1.5371385, -0.4985314], [-0.969266, 1.8760108, 0.041556], [0.0556434, -0.2040259, 1.0572252]] as const;

export function dot(a: readonly number[], b: readonly number[]): number {
	return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

export function transform(matrix: readonly (readonly number[])[], value: readonly number[]): Triple {
	return matrix.map(row => dot(row, value)) as Triple;
}

export function inverse(matrix: readonly (readonly number[])[]): Triple[] {
	const [a, b, c] = matrix;
	const cofactors = [
		[b[1] * c[2] - b[2] * c[1], a[2] * c[1] - a[1] * c[2], a[1] * b[2] - a[2] * b[1]],
		[b[2] * c[0] - b[0] * c[2], a[0] * c[2] - a[2] * c[0], a[2] * b[0] - a[0] * b[2]],
		[b[0] * c[1] - b[1] * c[0], a[1] * c[0] - a[0] * c[1], a[0] * b[1] - a[1] * b[0]],
	];
	const determinant = a[0] * cofactors[0][0] + a[1] * cofactors[1][0] + a[2] * cofactors[2][0];
	if (Math.abs(determinant) < 1e-12) throw new Error('Degenerate spectral basis');
	return cofactors.map(row => row.map(value => value / determinant) as Triple);
}

export function gaussianSpectrum(center: number, width: number): number[] {
	return WAVELENGTHS.map(wavelength => Math.exp(-0.5 * ((wavelength - center) / width) ** 2));
}

function asymmetricGaussian(wavelength: number, center: number, left: number, right: number): number {
	return Math.exp(-0.5 * ((wavelength - center) * (wavelength < center ? left : right)) ** 2);
}

// Wyman・Sloan・Shirley (2013), 式(4)・表1のCIE 1931近似。
// https://jcgt.org/published/0002/02/01/  波長幅5nmと台形則をここで含める。
export const XYZ_WEIGHTS: Triple[] = WAVELENGTHS.map((wavelength, index) => {
	const weight = index === 0 || index === WAVELENGTHS.length - 1 ? 2.5 : 5;
	return [
		weight * (0.362 * asymmetricGaussian(wavelength, 442, 0.0624, 0.0374) + 1.056 * asymmetricGaussian(wavelength, 599.8, 0.0264, 0.0323) - 0.065 * asymmetricGaussian(wavelength, 501.1, 0.049, 0.0382)),
		weight * (0.821 * asymmetricGaussian(wavelength, 568.8, 0.0213, 0.0247) + 0.286 * asymmetricGaussian(wavelength, 530.9, 0.0613, 0.0322)),
		weight * (1.217 * asymmetricGaussian(wavelength, 437, 0.0845, 0.0278) + 0.681 * asymmetricGaussian(wavelength, 459, 0.0385, 0.0725)),
	];
});

export function spectrumToXyz(spectrum: Spectrum): Triple {
	return [0, 1, 2].map(channel => spectrum.reduce((sum, value, index) => sum + value * XYZ_WEIGHTS[index][channel], 0)) as Triple;
}

function createReferenceWhite(): number[] {
	// 実測D65の分光分布ではなく、D65と等色する滑らかな非負の仮想光源。
	// 光源をRGBで着色するのではなく、三つの広帯域基底の混合比をXYZから求める。
	const bases = [gaussianSpectrum(610, 50), gaussianSpectrum(545, 40), gaussianSpectrum(450, 30)];
	const tristimuli = bases.map(spectrumToXyz);
	const coefficients = transform(inverse([0, 1, 2].map(channel => tristimuli.map(xyz => xyz[channel]))), transform(RGB_TO_XYZ, [1, 1, 1]));
	if (coefficients.some(value => value < 0)) throw new Error('Reference illuminant must be nonnegative');
	return WAVELENGTHS.map((_, index) => bases.reduce((sum, basis, channel) => sum + basis[index] * coefficients[channel], 0));
}

export const REFERENCE_WHITE = createReferenceWhite();

export function blackbodySpectrum(temperature: number): number[] {
	const spectrum = WAVELENGTHS.map(wavelength => 1 / ((wavelength / 560) ** 5 * Math.expm1(1.438776877e7 / (wavelength * temperature))));
	const luminance = spectrumToXyz(spectrum)[1];
	return spectrum.map(value => value / luminance);
}

type Basis = { spectrum: number[]; xyz: Triple };
export type SpectralTriangle = { bases: [Basis, Basis, Basis]; inverse: Triple[] };

function normalizedBasis(spectrum: Spectrum): Basis {
	const xyz = spectrumToXyz(spectrum);
	const total = xyz[0] + xyz[1] + xyz[2];
	return { spectrum: spectrum.map(value => value / total), xyz: xyz.map(value => value / total) as Triple };
}

function createSpectralTriangles(): SpectralTriangle[] {
	const white = normalizedBasis(REFERENCE_WHITE);
	const candidates = Array.from({ length: 27 }, (_, index) => normalizedBasis(gaussianSpectrum(420 + 10 * index, 12)));
	candidates.sort((a, b) => a.xyz[0] - b.xyz[0] || a.xyz[1] - b.xyz[1]);
	const cross = (a: Basis, b: Basis, c: Basis) => (b.xyz[0] - a.xyz[0]) * (c.xyz[1] - a.xyz[1]) - (b.xyz[1] - a.xyz[1]) * (c.xyz[0] - a.xyz[0]);
	const halfHull = (points: Basis[]) => {
		const hull: Basis[] = [];
		for (const point of points) {
			while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 1e-9) hull.pop();
			hull.push(point);
		}
		return hull.slice(0, -1);
	};
	const hull = [...halfHull(candidates), ...halfHull([...candidates].reverse())];
	return hull.map((basis, index) => {
		const bases: [Basis, Basis, Basis] = [white, basis, hull[(index + 1) % hull.length]];
		return { bases, inverse: inverse([0, 1, 2].map(channel => bases.map(item => item.xyz[channel]))) };
	});
}

export const SPECTRAL_TRIANGLES = createSpectralTriangles();

export function reconstructSpectrum(rgb: readonly number[]): number[] {
	const xyz = transform(RGB_TO_XYZ, rgb);
	if (xyz[1] <= 0) return WAVELENGTHS.map(() => 0);
	for (const triangle of SPECTRAL_TRIANGLES) {
		const weights = transform(triangle.inverse, xyz);
		if (weights[1] < -1e-6 * xyz[1] || weights[2] < -1e-6 * xyz[1]) continue;
		// RGBの負値を切らずXYZで再構成する。基底の色域外だけ白色点から境界へ射影し、
		// Yを保持する。スペクトルが負になる外挿は物理的な露光へ持ち込まない。
		const positive = weights.map(value => Math.max(0, value));
		const luminance = positive.reduce((sum, value, index) => sum + value * triangle.bases[index].xyz[1], 0);
		return WAVELENGTHS.map((_, sample) => positive.reduce((sum, value, index) => sum + value * triangle.bases[index].spectrum[sample], 0) * xyz[1] / luminance);
	}
	return REFERENCE_WHITE.map(value => value * xyz[1]);
}
