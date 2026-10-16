import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleSource } from './helpers/load-shader-source.mjs';

async function runGpuTest(entry, minimumChecks) {
	const bundle = await bundleSource(fileURLToPath(new URL(entry, import.meta.url)), 'browser');
	let resolveResult;
	const result = new Promise(resolve => { resolveResult = resolve; });
	const server = createServer((request, response) => {
		if (request.url === '/result') {
			let body = '';
			request.on('data', data => { body += data; });
			request.on('end', () => { response.end('OK'); resolveResult(JSON.parse(body)); });
		} else if (request.url === '/test.js') {
			response.setHeader('Content-Type', 'text/javascript');
			response.end(bundle.outputFiles[0].text);
		} else {
			response.setHeader('Content-Type', 'text/html');
			response.end(`<script type="module">
try { const { run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: await run() }) }); }
catch (error) { await fetch('/result', { method: 'POST', body: JSON.stringify({ error: error.stack }) }); }</script>`);
		}
	});
	const temporaryRoot = resolve(tmpdir());
	const profile = await mkdtemp(join(temporaryRoot, 'glitch-shader-test-'));
	let browser;
	let timer;
	try {
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		browser = spawn(process.env.CHROME_PATH, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', `--user-data-dir=${profile}`, `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: 'ignore' });
		browser.on('error', error => resolveResult({ error: error.message }));
		timer = setTimeout(() => resolveResult({ error: 'WebGPU test timed out' }), 45000);
		const output = await result;
		assert.equal(output.error, undefined, output.error);
		assert.ok(output.passed.length >= minimumChecks);
		return output.passed;
	} finally {
		clearTimeout(timer);
		if (browser && browser.exitCode === null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill();
			await exited;
		}
		server.closeAllConnections();
		await new Promise(resolve => server.close(resolve));
		assert.equal(dirname(resolve(profile)), temporaryRoot);
		assert.ok(basename(profile).startsWith('glitch-shader-test-'));
		await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}

// 【ChromeのWebGPUで生成WGSLの実画素を比較する】
// モックでは検出できないシェーダーとbindingの不整合を検出する。CIではChromeのパスを明示する。
test('renders generated shader inputs on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/shader-input-gpu.ts', 20));

// 【LUTの実シェーダーで恒等変換・半透明・入力範囲・複合変換を確認する】
// CPUパーサーのテストだけではbinding・半精度転送・3D補間のずれを検出できない。
// 同じAsset IDの差し替えと、定数／テクスチャ入力の両方を16bit・対応GPUでは32bitで検証する。
test('renders cube LUTs on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, async t => {
	const checks = await runGpuTest('./helpers/apply-lut-gpu.ts', 10);
	t.diagnostic(`${checks.length} checks: ${checks.join(', ')}`);
});

// 【分離したエフェクト・モジュール・エフェクトレイヤーの描画を実GPUで検証する】
// 複数出力・履歴交換・バイパス・リサイズに加え、レイヤーの下層入力・キー・合成後の画素を確認する。
test('renders extracted effects, visual modules and timeline effects on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/effect-renderer-gpu.ts', 14));

// 【グループの入れ子・空白・透明出力をChromeのWebGPUで検証する】
// Scene時刻と背景の分離、各段階のopacity、replace、無効化時の資源解放を実装経由で確認する。
test('renders nested timeline groups on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/timeline-group-gpu.ts', 5));

// 【カメラ投影とグループの2モードを実GPUで描画する】
// 画面外のText・Shapeの回復、Z、画面配置、子Scene、合成後のopacityを画素比較する。
test('renders timeline cameras and unbounded groups on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/timeline-camera-gpu.ts', 17));

// 【描画方式の変更による定常時の処理時間を同じシーンで計測する】
// GPU・ドライバーで変動するため任意実行の診断とし、時間の大小をテストの合否にしない。
test('benchmarks timeline plane compositing', { skip: !process.env.CHROME_PATH || !process.env.GS_CAMERA_BENCHMARK, timeout: 60000 }, async t => {
	for (const result of await runGpuTest('./helpers/timeline-camera-benchmark.ts', 2)) t.diagnostic(result);
});
