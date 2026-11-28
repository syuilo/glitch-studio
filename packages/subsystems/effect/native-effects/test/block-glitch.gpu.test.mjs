import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

const chromePathUnavailable = process.env.CHROME_PATH == null;
const entry = new URL('./block-glitch-browser.mjs', import.meta.url);

// 【ブロックの角度を画像シフトとチャンネルシフトに適用する】
// 非正方形の画面上でも幅方向の移動距離を保ち、タイルをまたいで同じ画素を参照できることを確認する。
test('rotates image and channel shifts with each block on a non-square tiled output', { skip: chromePathUnavailable }, async () => {
	await runEffectGpuTest(entry, 'checkBlockGlitchRotation');
});

// 【重なり部分で透明な結果も上書きする】
// ブロックの重なりで背後の入力やブロックが透けると、出力の輪郭が画像シフト先と一致しなくなる。
test('replaces overlapping blocks even when the winning sample is transparent', { skip: chromePathUnavailable }, async () => {
	await runEffectGpuTest(entry, 'checkBlockGlitchOverlap');
});

// 【入力画像の別の位置から矩形をサンプリングする】
// Containの余白を避けて参照中心を選び、周囲の位置関係とSeedによる再現性を保つことを確認する。
test('samples a deterministic image patch from a random source position', { skip: chromePathUnavailable }, async () => {
	await runEffectGpuTest(entry, 'checkBlockGlitchRandomPosition');
});
