import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/utility/image-analysis-axis.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createImageValueAxisTicks, selectImageAnalysisAxisTicks } = module.exports;

// 【データ用Linear軸の目盛りは値に比例し、符号付き範囲では0を中央の基準にする】
// GPU側だけが新しい範囲へ切り替わると、波形やヒストグラムの正しい位置に誤った値を表示してしまう。
// 端点・中間値の位置とラベルを確認し、sRGB用の非線形な位置への変換も防ぐ。
test('labels data ranges with evenly spaced linear values and a centered zero reference', () => {
	const unsigned = createImageValueAxisTicks('linearZeroToOne');
	assert.deepEqual(unsigned.map(tick => tick.position), [0, 0.25, 0.5, 0.75, 1]);
	assert.deepEqual(unsigned.map(tick => tick.label), ['0', '0.25', '0.5', '0.75', '1']);
	const signed = createImageValueAxisTicks('linearMinusOneToOne');
	assert.deepEqual(signed.map(tick => tick.position), [0, 0.25, 0.5, 0.75, 1]);
	assert.deepEqual(signed.map(tick => tick.label), ['−1', '−0.5', '0', '0.5', '1']);
	assert.deepEqual(signed.filter(tick => tick.isReference).map(tick => tick.value), [0]);
});

// 【小さい解析パネルでも、両端と符号の境目を他の中間目盛りより優先する】
// 0の基準が消えると正負を見分けにくいため、目盛りを間引いても基準線とラベルを一緒に残す。
// 縦波形の値軸と横波形の反転した値軸の両方で、同じ意味を保つことを確認する。
test('keeps the signed zero reference when thinning either axis direction', () => {
	const ticks = createImageValueAxisTicks('linearMinusOneToOne');
	for (const reversed of [false, true]) {
		const directedTicks = ticks.map(tick => ({ ...tick, position: reversed ? 1 - tick.position : tick.position }));
		const selected = selectImageAnalysisAxisTicks(directedTicks, 100, 48);
		assert.deepEqual(selected.map(tick => tick.value), reversed ? [1, 0, -1] : [-1, 0, 1]);
		assert.equal(selected[1].position, 0.5);
		assert.equal(selected[1].isReference, true);
	}
});
