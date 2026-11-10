import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const execute = promisify(execFile);
for (const [runtime, environmentName] of [['chrome', 'CHROME_PATH'], ['electron', 'ELECTRON_PATH']]) {
	// 【実プレビューのWorker出力は広色域を保持し、CPU表示とSDR書き出しはsRGBのままにする】
	// Canvas APIだけの検証ではアプリのshader・出力設定の接続ミスを検出できない。
	// 線形Canvasが未対応のElectronも含め、同じ転送済みOffscreenCanvasの経路を通す。
	test(`renders wide-gamut GPU previews and keeps CPU and export in sRGB in ${runtime}`, {
		skip: process.env[environmentName] == null, timeout: 60000,
	}, async t => {
		const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('../scripts/probe-canvas-color-output.mjs', import.meta.url)),
			'--runtime', runtime, '--executable', process.env[environmentName], '--preview'], { windowsHide: true });
		const report = JSON.parse(stdout);
		assert.equal(report.error, undefined);
		assert.equal(report.checks.length, 5);
		t.diagnostic(`${report.runtime}; ${report.checks.join(', ')}`);
	});

	// 【ChromeとElectronの色空間対応を個別に調べ、対応するfloat出力では広色域値を保持する】
	// 線形色空間を受け付けないランタイムでも、通常のsRGB/P3のfloat出力は利用できる。
	// enumの対応状況と実画素の正しさを分け、未対応を画素検証の成功として扱わない。
	test(`preserves wide-gamut canvas pixels and reports supported color spaces in ${runtime}`, {
		skip: process.env[environmentName] == null, timeout: 60000,
	}, async t => {
		const { stdout } = await execute(process.execPath, [fileURLToPath(new URL('../scripts/probe-canvas-color-output.mjs', import.meta.url)),
			'--runtime', runtime, '--executable', process.env[environmentName]], { windowsHide: true });
		const report = JSON.parse(stdout);
		assert.equal(report.error, undefined);
		for (const colorSpace of ['srgb', 'display-p3']) {
			const output = report.results.find(result => result.colorSpace === colorSpace);
			assert.equal(output.supported, true);
			assert.equal(output.values.length, 8);
		}
		const srgb = report.results.find(result => result.colorSpace === 'srgb');
		assert.ok(srgb.values[4] > 1 && srgb.values[5] < 0 && srgb.values[6] < 0);
		t.diagnostic(`${report.runtime}; ${report.results.map(result => `${result.colorSpace}: ${result.supported}`).join(', ')}`);
	});
}
