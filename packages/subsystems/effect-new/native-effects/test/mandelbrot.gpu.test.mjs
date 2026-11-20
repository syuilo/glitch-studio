import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【高精度基準軌道とGPUの摂動計算を、独立した十進多倍長の直接反復と比較する】
// 1e300のズーム、R=2の微小な発散差、基準点だけの先行発散、TIA・AA・疎な出力を実画素で検証する。
// CPUテストだけでは分からないWGSLの指数演算・storageの配置・通常描画との接続の誤りを検出する。
test('renders deep Mandelbrot zooms and existing coloring on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 120000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/mandelbrot-gpu.ts', import.meta.url), 'run', 105000, [process.env.MANDELBROT_BENCHMARK === '1']);
	assert.ok(output.checks.length >= 30);
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
	if (output.timings != null) t.diagnostic(JSON.stringify(output.timings));
});
