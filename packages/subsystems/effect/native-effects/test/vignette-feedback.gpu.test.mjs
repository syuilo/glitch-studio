import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

const browserTests = new URL('./vignette-feedback-browser.mjs', import.meta.url);
const options = { skip: process.env.CHROME_PATH == null };

// 【Vignetteは色・マスク・両方の各構成で必要な上流と描画先だけを使用する】
// 親からマスクを先に要求しても、後から必要となった色入力を先に描き、両出力の画素を一致させる。
test('renders the selected Vignette ports in one pass on WebGPU', options, () => runEffectGpuTest(browserTests, 'vignette'));

// 【色定数から描いたVignetteをFeedbackに接続し、同じ画素の履歴を減衰させる】
// 場所によって値の異なる画像を使い、履歴の参照位置のずれや色入力のalpha二重乗算を検出する。
test('decays each pixel from a Vignette texture at its original position on WebGPU', options, () => runEffectGpuTest(browserTests, 'vignetteIntoFeedback'));

// 【Feedbackの履歴を配置ごとに一度だけ進め、下流から最新の出力を読む】
// 初期化時のテクスチャを下流が保持してしまうと、片方のフレームだけ古い画素が表示される。
test('publishes alternating Feedback textures and resets nested history on WebGPU', options, () => runEffectGpuTest(browserTests, 'feedback'));

// 【グラフ内のFeedback入力の編集とUndoをまたいで蓄積した画素を維持する】
// 既存の履歴と新しい入力が半減期に従って混ざることをGPUから読み戻し、再初期化による履歴の消失を検出する。
test('keeps Feedback pixels across Nodes Effect node value edits and undo on WebGPU', options, () => runEffectGpuTest(browserTests, 'editFeedbackInput'));

// 【タイル描画を中断して再開し、全画素・履歴・パス計測を確認する】
// 未送信のタイルや中断したフレームのキャッシュが残ると、再開後に古い画像が混ざる。
test('recovers tiled rendering and reports GPU time per placement and pass', options, () => runEffectGpuTest(browserTests, 'tiledHistory'));

// 【自動分割したCustom Shader Effectで端数タイルまで全画素が一致する】
// timestamp-queryを要求せず、GPU時間を取得できない環境でも長時間パスを分割し、統計の欠落を通知する。
test('renders adaptive Custom Shader Effect tiles without timestamp queries', options, () => runEffectGpuTest(browserTests, 'automaticTiling'));
