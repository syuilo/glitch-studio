import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpticalSceneData, OPTICAL_RECORD_BYTES } from '../src/fx/geometricOptics2d/scene-data.ts';

const resolution = { width: 1920, height: 1080 };
const limits = { maxBufferSize: 256 * 1024 ** 2, maxStorageBufferBindingSize: 128 * 1024 ** 2, maxComputeWorkgroupsPerDimension: 65535 };
const source = { type: 'parallelBeam', position: [-0.4, 0], direction: 0, width: 0.2, spread: 1, power: 2, spectrum: 'white', wavelength: 550 };
const settings = { sources: [source], objects: [], raySamples: 4, wavelengthSamples: 9, pathBudget: 1024 };

// 【GPUの確保前に一次光線数と個別buffer・dispatchの上限を検査する】
// 光源を黙って省略したり、一つの光源だけで予算を使い切ると、品質変更により構図が変わってしまう。
// 予算不足は明示的に拒否し、GPUのbinding上限をbuffer合計と取り違えないことも確認する。
test('rejects insufficient path budgets and GPU capacities before allocating ray data', () => {
	assert.equal(createOpticalSceneData(settings, resolution, limits).rootCount, 36);
	assert.throws(() => createOpticalSceneData({ ...settings, pathBudget: 35 }, resolution, limits), /Path Budget must be at least/);
	assert.throws(() => createOpticalSceneData(settings, resolution, { ...limits, maxStorageBufferBindingSize: 1024 * OPTICAL_RECORD_BYTES - 1 }), /GPU resource limits/);
	assert.throws(() => createOpticalSceneData({ ...settings, raySamples: 16 }, resolution, { ...limits, maxComputeWorkgroupsPerDimension: 2 }), /GPU resource limits/);
	assert.equal(createOpticalSceneData(settings, resolution, { ...limits, maxStorageBufferBindingSize: 1024 * OPTICAL_RECORD_BYTES }).pathBudget, 1024);
});

// 【品質と出力寸法にかかわらず、光源の総パワーと白の応答を保つ】
// 分光サンプルの単純な間引きは白の色を変え、光線数で正規化しない実装は品質を上げるほど明るくなる。
// 計算格子を出力画素へ依存させないことと、微弱な色の負成分も落とさないことを確認する。
test('conserves white spectral response and source power across sampling and resolution', () => {
	for (const raySamples of [1, 7, 32]) {
		for (const wavelengthSamples of [1, 3, 9, 27, 81]) {
			const params = { ...settings, raySamples, wavelengthSamples, pathBudget: 8192 };
			const scene = createOpticalSceneData(params, resolution, limits);
			assert.deepEqual(scene.roots, createOpticalSceneData(params, { width: 320, height: 180 }, limits).roots);
			const response = [0, 0, 0, 0];
			for (let index = 0; index < scene.rootCount; index++) {
				for (let channel = 0; channel < 4; channel++) response[channel] += scene.roots[index * 12 + 4 + channel] * scene.roots[index * 12 + 9];
			}
			for (const channel of response) assert.ok(Math.abs(channel - source.power) < 1e-6, `${raySamples}/${wavelengthSamples}: ${response}`);
		}
	}
	const monochromatic = createOpticalSceneData({ ...settings, sources: [{ ...source, spectrum: 'monochromatic', wavelength: 550 }] }, resolution, limits);
	assert.ok(monochromatic.roots[4] < 0, 'out-of-gamut spectral RGB must retain its signed response');
});

// 【式による極端な入力と単一光線を扱う】
// 巨大なturn値をそのままラジアンへ換算するとInfinityになり、GPUへNaNの光路を渡してしまう。
// 無効な数値の既定化、0パワー光源の除外、Single RayがRay Samplesに依存しないことを確認する。
test('keeps animated numeric inputs finite and single-ray counts independent of ray samples', () => {
	const params = { ...settings, sources: [{ ...source, type: 'singleRay', spectrum: 'monochromatic', direction: 1e308, position: [Infinity, -1e308], wavelength: NaN }, { ...source, power: 0 }], raySamples: 2048 };
	const scene = createOpticalSceneData(params, resolution, limits);
	assert.equal(scene.rootCount, 1);
	assert.ok(scene.roots.every(Number.isFinite));
	assert.equal(scene.roots[8], 550);
	assert.ok(scene.maximumAbsoluteResponse > 0);
});
