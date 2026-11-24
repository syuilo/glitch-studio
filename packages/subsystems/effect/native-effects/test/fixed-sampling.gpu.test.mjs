import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

const entry = new URL('./fixed-sampling-browser.mjs', import.meta.url);
const options = { skip: process.env.CHROME_PATH == null };

// 【Interpolatorで固定配列の入力を小数Indexに応じて補間する】
// 異種入力間の補間と整数端点、空配列でのゼロ値が、スカラー・ベクトル・乗算済みRGBAで保たれることを確認する。
test('interpolates fixed candidates of each output type', options, () => runEffectGpuTest(entry, 'interpolators'));

// 【Interpolatorの候補がテクスチャ上限を超えても必要な候補だけをbindする】
// 候補の総数にかかわらず、整数端点では1枚、補間中は2枚だけをbindする。
// 候補の切り替え後も入力固有のFit・Wrap・Filterで読み、pipelineを再作成しない。
test('binds only textures that contribute to interpolation when candidates exceed the device limit', options, () => runEffectGpuTest(entry, 'interpolatorTextureBindings'));

// 【Selectorは小数Indexでも近い候補の値をそのまま出力する】
// 定数とテクスチャの境界で2候補を混ぜない。端点への丸めと空配列のゼロ値は、出力型にかかわらず成立する。
test('selects one nearest candidate of each output type without interpolation', options, () => runEffectGpuTest(entry, 'selectors'));

// 【Selectorは候補がテクスチャ上限を超えても選んだ1枚だけをbindする】
// 連続して候補を切り替えても、各入力のFit・Wrap・Filterと1枚のbindingを両立する。
test('binds one selected texture when candidates exceed the device limit', options, () => runEffectGpuTest(entry, 'selectorTextureBindings'));

// 【Switch (Color)はbool式で定数色と画像を切り替える】
// 選ばれた入力の色とalphaを出力し、条件が変わっても両入力から決めた自動解像度とpipelineを維持する。
test('switches between a constant color and texture without changing automatic resolution', options, () => runEffectGpuTest(entry, 'colorSwitch'));

// 【進捗で変化する分割領域に合わせてFitを更新する】
// 入力画像の寸法・世代が同じでも、全幅と半幅ではcoverで表示する画素が変わる。
test('updates cover mapping when split regions resize', options, () => runEffectGpuTest(entry, 'regionFit'));

// 【同じCell Transformの画像端処理を切り替える】
// 同じ画像を画面幅ぶんずらし、サンプラーと透明境界のフラグが同じフレームで切り替わることを画素値で確認する。
test('updates cell image wrap and transparent coverage together', options, () => runEffectGpuTest(entry, 'imageWrap'));
