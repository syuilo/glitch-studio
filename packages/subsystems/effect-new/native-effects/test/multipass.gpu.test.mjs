import test from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

const entry = new URL('./multipass-browser.mjs', import.meta.url);

// 【半径と演算を切り替えても各段の結果を次の段が読む】
// 1パスと複数パスを同じ配置で往復し、中間テクスチャの読み書き順とパス固有のuniform領域を画素値で確認する。
test('composes dilation and erosion passes at changing radii', { skip: process.env.CHROME_PATH == null }, () =>
	runEffectGpuTest(entry, 'morphology'));

// 【Shatter Transitionは画像を参照せずにCoverageだけを描画できる】
// 端点と途中の形状を同じ配置で行き来し、色の有無が被覆の計算やpipeline数に影響しないことを確認する。
test('renders shatter coverage independently across progress changes', { skip: process.env.CHROME_PATH == null }, () =>
	runEffectGpuTest(entry, 'shatterCoverage'));


// 【記録が破棄されたヒストグラムを再生成する】
// 密度の中間結果を再利用する配置でも、未送信のGPUコマンドを完了済みとして扱うと次の描画が空になる。
test('rebuilds cached attractor density after discarding recorded work', { skip: process.env.CHROME_PATH == null }, () =>
	runEffectGpuTest(entry, 'discardedHistogram'));
