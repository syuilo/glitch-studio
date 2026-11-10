import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleSource } from './helpers/load-shader-source.mjs';

async function runGpuTest(entry, minimumChecks, exportName = 'run') {
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
try { const { ${exportName}: run } = await import('/test.js'); await fetch('/result', { method: 'POST', body: JSON.stringify({ passed: await run() }) }); }
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

// 【EXR用の読み戻しでHDR・負値・透明発光・行方向を保持し、Scene描画も表示設定から独立する】
// 奇数幅の行padding、GPUバッチ境界と末尾行、途中中断を実GPUで検証する。
// モーションブラーを有効にしたManagerも通し、表示用Canvasへの誤接続を検出する。
test('reads linear HALF scene images without applying display transforms', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/linear-image-export-gpu.ts', 4));

// 【ChromeのWebGPUで生成WGSLの実画素を比較する】
// モックでは検出できないシェーダーとbindingの不整合を検出する。CIではChromeのパスを明示する。
test('renders generated shader inputs on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/shader-input-gpu.ts', 20));

// 【CPU表示でも色・透明度・上下方向と全ての映像解析Canvasを保つ】
// 実GPUでの読み戻しとCanvas 2Dのalpha変換はモックだけでは検証できない。
test('presents preview and analysis canvases through CPU readback', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/cpu-preview-gpu.ts', 4));

// 【linearの表示背景は停止中も動作し、解析軸は表示sRGBと作業値を区別する】
// CSS合成への逆戻りや、借用テクスチャ破棄後のGPU参照・CPU表示枠の漏れを検出する。
test('animates owned linear preview backgrounds and distinguishes analysis scales', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/linear-display-gpu.ts', 9));

// 【Alpha・ベクトル成分・長さを生の数値として、全ての映像解析Canvasへ表示する】
// 実シェーダーの対象選択・透明画素の集計・範囲制限・白い描画と、両方向の座標を検証する。
test('analyzes alpha and vector data in histograms and both waveforms on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/image-analysis-gpu.ts', 24));

// 【全画素の保持解析は作業画像の変更・破棄から独立し、設定変更と通常表示への復帰に対応する】
// 量子化前の保持精度、全画素のカウント、固定点カウンターのあふれ、CPU転送の休止は実GPUで検証する。
test('holds and reanalyzes High-res snapshots without overflow on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/high-resolution-analysis-gpu.ts', 14));

// 【波形のCanvas・集計ビンはパネル実寸へ追従し、停止中と保持中も最新の解像度で表示する】
// GPU表示とCPU読み戻しの両方で、元画像の破棄後にも再解析でき、固定寸法や空の位置ビンへ戻らないことを確認する。
test('resizes waveform canvases and held analysis to the panel resolution on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/waveform-canvas-size-gpu.ts', 8));

// 【波形ズームでは拡大領域を再集計し、元画素の細部・値のクリップ・保持画像を正しく扱う】
// Canvasを引き伸ばすだけでは区別できない交互画素が分離することを、GPU・CPU表示の実画素で比較する。
test('reanalyzes waveform viewports at native detail on WebGPU and CPU displays', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/waveform-viewport-gpu.ts', 10));

// 【直接集計と分割集計を往復しても、色・数値データの表示結果とu32境界でのカウントを保つ】
// 65537サンプルちょうどの不透明な重みはu32上限そのものとなるため、実GPUで境界の1つ上まで比較する。
// 集計・描画pipelineの切り替え漏れや、同じ所有者で通常経路へ戻ったときの古い結果も検出する。
test('preserves image analysis across direct and partial accumulation boundaries on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/image-analysis-accumulation-gpu.ts', 10));

// 【複数VideoノードでPlayerの正規化画像を共有し、更新・切断・破棄でも正しい画素を保つ】
// GPU資源の借用と更新はCPUのモックだけでは検証できず、コピー回数と実画素の両方を見る。
test('shares normalized player images between Video nodes on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/player-video-textures-gpu.ts', 8));

// 【半透明の広色域素材も、正しいlinear RGBの光量とalphaで読み込む】
// 不透明のDisplay P3と半透明のsRGBが個別に通っても、デコード指定によって両者の組み合わせだけが暗くなり得る。
// AssetTexturesによる実際のPNGデコードからGPU転送までを通し、浮動小数点の画素で検証する。
test('imports opaque and translucent Display P3 assets without darkening', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, () => runGpuTest('./helpers/linear-display-gpu.ts', 3, 'runWideGamutAssetImport'));

// 【GPU・CPU表示とも露出を線形光で適用し、alpha・解析・元画像の警告を保つ】
// 半透明やHDRの補正は8bit画像やuniformのモックだけでは検証できない。
// 実際の表示経路で0 EV、増減、範囲端を比較し、解析Canvasに補正が混入しないことも確認する。
// 色域圧縮の全プリセット・カスタム・無圧縮と、通常表示では潰れる赤の分離も実画素で比較する。
test('adjusts preview exposure and gamut compression without changing alpha, analysis or clipping warnings', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/preview-exposure-gpu.ts', 26));

// 【全画面三角形への変更で座標・微分・透明度・画面端の被覆を変えない】
// 移行前の2枚の三角形と全画素を比較する。通常のサイズに加え、奇数寸法と1画素幅も確認し、
// 頂点数だけを変更した際の描画欠落や、UVの範囲・上下方向・対角線での重複を検出する。
test('preserves fullscreen coordinates and coverage with a single triangle on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, async t => {
	const checks = await runGpuTest('./helpers/fullscreen-triangle-gpu.ts', 28);
	t.diagnostic(`${checks.length} full-image comparisons completed`);
});

// 【キャッシュの実GPUコピーで元の精度と8bitの量子化を確認し、元画像の更新から独立させる】
// 容量やLRUのモックでは、sRGB変換・alpha・HDR制限やRGBA/BGRAの取り違えを検出できない。
test('preserves timeline frame cache pixels on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/timeline-preview-frame-cache-gpu.ts', 16));

// 【合成と適用範囲の実画素を、他のエフェクトのテスト素材に依存せず確認する】
// 固定された画像座標と変形する枠、透明結果のReplace、マスク、祖先・カメラを実WGSLで検証する。
test('renders timeline compositing and application regions on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, async t => {
	const checks = await runGpuTest('./helpers/effect-renderer-gpu.ts', 50, 'runTimelineCompositor');
	t.diagnostic(`${checks.length} pixel checks completed`);
});

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

// 【Custom Shader Effectの複数出力と共通座標・透明度・診断を実GPUで検証する】
// WGSL生成とbindingは型チェックだけでは保証できず、uniformとtextureの切替も描画結果で確認する。
test('renders project Custom Shader Effects on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/effect-renderer-gpu.ts', 12, 'runCustomShaderEffects'));

// 【ライブプレビューの入口で準備中のフレームをスキップし、コンパイル後に実画素まで描画する】
// Renderer.prepareをテスト側で呼ぶだけでは、Managerが準備を省略する不具合を検出できない。
test('skips Visual Module Live Preview frames during shader compilation', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/custom-shader-effect-gpu.ts', 4, 'runCustomShaderEffectLivePreview'));

// 【Timelineも同じManagerとGPUDeviceへ定義を更新し、同一時刻の旧キャッシュを使わない】
// Layerの主出力を変更しても新しいpipelineへ解決し、更新後の画素が表示されることを確認する。
test('updates Custom Shader Effects in the existing Timeline manager', { skip: !process.env.CHROME_PATH, timeout: 60000 }, () => runGpuTest('./helpers/custom-shader-effect-gpu.ts', 2, 'runCustomShaderEffectTimelineUpdates'));

// 【分割レベルを変えても実エフェクトの全画素と履歴を維持する】
// モックではScissor、clear、MRT、異なる中間解像度、Computeとの同期の誤りを検出できない。
// 奇数寸法と1画素幅で、分割なしと各分割レベルの出力を画素比較する。
test('preserves effect pixels across render tile division levels on WebGPU', { skip: !process.env.CHROME_PATH, timeout: 60000 }, async t => {
	const checks = await runGpuTest('./helpers/effect-renderer-gpu.ts', 30, 'runTiledEffects');
	t.diagnostic(`${checks.length} tiled output comparisons completed`);
});
