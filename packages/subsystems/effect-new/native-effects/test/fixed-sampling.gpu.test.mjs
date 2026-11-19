import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

const entry = new URL('./fixed-sampling-browser.mjs', import.meta.url);
const options = { skip: process.env.CHROME_PATH == null };

// 【Selectorの固定配列から小数Indexで選択する】
// 異種入力間の補間と整数端点、空配列でのゼロ値が、スカラー・ベクトル・乗算済みRGBAで保たれることを確認する。
test('selects and interpolates fixed candidates of each output type', options, () => runEffectGpuTest(entry, 'selectors'));

// 【進捗で変化する分割領域に合わせてFitを更新する】
// 入力画像の寸法・世代が同じでも、全幅と半幅ではcoverで表示する画素が変わる。
test('updates cover mapping when split regions resize', options, () => runEffectGpuTest(entry, 'regionFit'));

// 【同じCell Transformの画像端処理を切り替える】
// 同じ画像を画面幅ぶんずらし、サンプラーと透明境界のフラグが同じフレームで切り替わることを画素値で確認する。
test('updates cell image wrap and transparent coverage together', options, () => runEffectGpuTest(entry, 'imageWrap'));
