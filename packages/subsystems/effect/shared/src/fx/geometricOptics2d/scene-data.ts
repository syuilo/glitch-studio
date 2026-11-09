import { inputUvScale } from '@gs/shared/gpu/input-fit.ts';
import { createSpectralSamples, SPECTRAL_SAMPLE_COUNT, SPECTRAL_MINIMUM_WAVELENGTH_NM, SPECTRAL_WAVELENGTH_STEP_NM } from '../../optics/spectral-samples.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

export type GeometricOpticsParameters = RuntimeEffectParameters<typeof definition.paramDefs>;
export const OPTICAL_RECORD_BYTES = 48;
const spectralSamples = createSpectralSamples();

function finite(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

export function bounded(value: number, minimum: number, maximum: number, fallback: number): number {
	return Math.min(maximum, Math.max(minimum, finite(value, fallback)));
}

function whiteSamples(count: number): { wavelength: number; response: number[]; weight: number }[] {
	// 81点の等色応答を区間ごとに合算する。少数の代表波長で経路を近似しても、
	// 分散も吸収もない白色光のRGB合計が常に[1,1,1]になるようにする。
	return Array.from({ length: count }, (_, index) => {
		const first = Math.floor(index * SPECTRAL_SAMPLE_COUNT / count);
		const end = Math.floor((index + 1) * SPECTRAL_SAMPLE_COUNT / count);
		const response = [0, 0, 0];
		for (let sample = first; sample < end; sample++) {
			for (let channel = 0; channel < 3; channel++) response[channel] += spectralSamples[sample * 4 + channel];
		}
		return { wavelength: SPECTRAL_MINIMUM_WAVELENGTH_NM + (first + end - 1) * 0.5 * SPECTRAL_WAVELENGTH_STEP_NM, response, weight: (end - first) / SPECTRAL_SAMPLE_COUNT };
	});
}

function monochromaticSample(wavelength: number) {
	const position = (wavelength - SPECTRAL_MINIMUM_WAVELENGTH_NM) / SPECTRAL_WAVELENGTH_STEP_NM;
	const first = Math.floor(position);
	const next = Math.min(SPECTRAL_SAMPLE_COUNT - 1, first + 1);
	const fraction = position - first;
	// 白色の総放射パワーを1とする基準と揃える。RGB色域外の負成分も保持する。
	// 白色積分の端点の1/2重みは単色の等色応答には不要なので、補間前に取り除く。
	const firstWeight = first === 0 || first === SPECTRAL_SAMPLE_COUNT - 1 ? 2 : 1;
	const nextWeight = next === 0 || next === SPECTRAL_SAMPLE_COUNT - 1 ? 2 : 1;
	const response = [0, 1, 2].map(channel => (spectralSamples[first * 4 + channel] * firstWeight * (1 - fraction) + spectralSamples[next * 4 + channel] * nextWeight * fraction) * SPECTRAL_SAMPLE_COUNT);
	return { wavelength, response, weight: 1 };
}

export function createOpticalSceneData(params: GeometricOpticsParameters, resolution: { width: number; height: number }, limits: Pick<GPUSupportedLimits, 'maxBufferSize' | 'maxStorageBufferBindingSize' | 'maxComputeWorkgroupsPerDimension'>) {
	const raySamples = Math.round(bounded(params.raySamples, 1, 2048, 128));
	const wavelengthSamples = Math.round(bounded(params.wavelengthSamples, 1, SPECTRAL_SAMPLE_COUNT, 9));
	const pathBudget = Math.round(bounded(params.pathBudget, 1, 262144, 65536));
	const sources = params.sources.filter(source => finite(source.power, 1) > 0);
	const rootCount = sources.reduce((sum, source) => sum + (source.type === 'singleRay' ? 1 : raySamples) * (source.spectrum === 'white' ? wavelengthSamples : 1), 0);
	const bufferLimit = Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize);
	if (!Number.isSafeInteger(rootCount) || rootCount > pathBudget) throw new Error('2D Geometric Optics: Path Budget must be at least the number of primary rays. Increase Path Budget or reduce Sources, Ray Samples or Wavelength Samples.');
	if (Math.max(1, rootCount, params.objects.length, pathBudget) * OPTICAL_RECORD_BYTES > bufferLimit || Math.ceil(rootCount / 64) > limits.maxComputeWorkgroupsPerDimension) {
		throw new Error('2D Geometric Optics exceeds GPU resource limits. Reduce Path Budget, Sources, Ray Samples or Wavelength Samples.');
	}
	const roots = new Float32Array(Math.max(1, rootCount) * OPTICAL_RECORD_BYTES / 4);
	const absoluteResponse = [0, 0, 0, 0];
	const white = whiteSamples(wavelengthSamples);
	let rootIndex = 0;
	for (const source of sources) {
		const samples = source.type === 'singleRay' ? 1 : raySamples;
		const spectrum = source.spectrum === 'white' ? white : [monochromaticSample(bounded(source.wavelength, 380, 780, 550))];
		const angle = (finite(source.direction, 0) % 1) * Math.PI * 2;
		const direction = [Math.cos(angle), -Math.sin(angle)];
		const powerPerRay = bounded(source.power, 0, 10000, 1) / samples;
		for (let ray = 0; ray < samples; ray++) {
			const offset = (ray + 0.5) / samples - 0.5;
			const rayAngle = angle + (source.type === 'pointSource' ? offset * bounded(source.spread, 0, 1, 1) * Math.PI * 2 : 0);
			const widthOffset = source.type === 'parallelBeam' ? offset * bounded(source.width, 0, 10, 0.2) : 0;
			for (const sample of spectrum) {
				roots.set([
					bounded(source.position[0], -1000000, 1000000, -0.4) - direction[1] * widthOffset, bounded(source.position[1], -1000000, 1000000, 0) + direction[0] * widthOffset,
					Math.cos(rayAngle), -Math.sin(rayAngle),
					...sample.response, sample.weight,
					sample.wavelength, powerPerRay, 0, 0,
				], rootIndex * 12);
				for (let channel = 0; channel < 3; channel++) absoluteResponse[channel] += Math.abs(sample.response[channel]) * powerPerRay;
				absoluteResponse[3] += sample.weight * powerPerRay;
				rootIndex++;
			}
		}
	}
	const objects = new Float32Array(Math.max(1, params.objects.length) * OPTICAL_RECORD_BYTES / 4);
	const sdfs: ShaderInput[] = [];
	const longDimension = Math.max(resolution.width, resolution.height);
	for (const [index, object] of params.objects.entries()) {
		const input = object.sdf;
		const scale = input.kind === 'texture' ? inputUvScale(input.texture, resolution, input.fitMode) : [1, 1];
		const transparent = input.kind === 'texture' && input.wrapMode === 'transparent';
		// SDFの透明領域を距離0として補間すると偽の表面ができる。
		// 値はclampで延長し、WGSL側で入力領域の矩形との共通部分を取る。
		sdfs.push(transparent ? { ...input, wrapMode: 'clamp' } : input);
		const gradientStep = input.kind === 'texture'
			? Math.max(1 / longDimension, resolution.width / (longDimension * input.texture.width * scale[0]), resolution.height / (longDimension * input.texture.height * scale[1]))
			: 1 / longDimension;
		objects.set([
			{ dielectric: 0, mirror: 1, absorber: 2 }[object.material], bounded(object.ior, 1, 10, 1.5), bounded(object.dispersion, 0, 0.1, 0), bounded(object.reflectivity, 0, 1, 1),
			bounded(object.absorptionRed, 0, 1000, 0), bounded(object.absorptionGreen, 0, 1000, 0), bounded(object.absorptionBlue, 0, 1000, 0), gradientStep,
			...scale, Number(transparent), 0,
		], index * 12);
	}
	return { roots, objects, sdfs, rootCount, pathBudget, maximumAbsoluteResponse: Math.max(...absoluteResponse) };
}
