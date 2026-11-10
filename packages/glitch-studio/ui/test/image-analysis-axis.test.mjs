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
	const unsigned = createImageValueAxisTicks('linear', { minimum: 0, maximum: 1 });
	assert.deepEqual(unsigned.map(tick => tick.position), [0, 0.25, 0.5, 0.75, 1]);
	assert.deepEqual(unsigned.map(tick => tick.label), ['0', '0.25', '0.5', '0.75', '1']);
	const signed = createImageValueAxisTicks('linear', { minimum: -1, maximum: 1 });
	assert.deepEqual(signed.map(tick => tick.position), [0, 0.25, 0.5, 0.75, 1]);
	assert.deepEqual(signed.map(tick => tick.label), ['−1', '−0.5', '0', '0.5', '1']);
	assert.deepEqual(signed.filter(tick => tick.isReference).map(tick => tick.value), [0]);
});

// 【小さい解析パネルでも、両端と符号の境目を他の中間目盛りより優先する】
// 0の基準が消えると正負を見分けにくいため、目盛りを間引いても基準線とラベルを一緒に残す。
// 縦波形の値軸と横波形の反転した値軸の両方で、同じ意味を保つことを確認する。
test('keeps the signed zero reference when thinning either axis direction', () => {
	const ticks = createImageValueAxisTicks('linear', { minimum: -1, maximum: 1 });
	for (const reversed of [false, true]) {
		const directedTicks = ticks.map(tick => ({ ...tick, position: reversed ? 1 - tick.position : tick.position }));
		const selected = selectImageAnalysisAxisTicks(directedTicks, 100, 48);
		assert.deepEqual(selected.map(tick => tick.value), reversed ? [1, 0, -1] : [-1, 0, 1]);
		assert.equal(selected[1].position, 0.5);
		assert.equal(selected[1].isReference, true);
	}
});

// 【任意範囲と反転範囲でも、端点と0の目盛りがGPUの正規化位置へ一致する】
// 固定プリセットの表を参照するだけではCustomに追従せず、Min > Maxではラベルの順序も逆になる。
// 小数の丸め誤差をラベルへ出さず、EVも独立した範囲の単位で表示することを確認する。
test('positions readable custom ticks for all scales and reversed ranges', () => {
	for (const valueScale of ['srgb', 'linear', 'ev']) {
		for (const [minimum, maximum] of [[-1, 4], [-0.5, 0.5], [-0.1, 0.9], [0.9, -0.1], [-10, 10]]) {
			const ticks = createImageValueAxisTicks(valueScale, { minimum, maximum });
			assert.equal(ticks[0].value, minimum);
			assert.equal(ticks[0].position, 0);
			assert.equal(ticks.at(-1).value, maximum);
			assert.equal(ticks.at(-1).position, 1);
			assert.ok(ticks.every(tick => tick.position >= 0 && tick.position <= 1));
			assert.equal(ticks.find(tick => tick.value === 0).position, (0 - minimum) / (maximum - minimum));
		}
	}
	assert.deepEqual(createImageValueAxisTicks('linear', { minimum: 0.001, maximum: 0.002 }).map(tick => tick.label), ['0.001', '0.00125', '0.0015', '0.00175', '0.002']);
	assert.equal(createImageValueAxisTicks('ev', { minimum: -10, maximum: 10 }).at(-1).label, '+10');
});

// 【幅0の範囲では、GPUの空表示に対応して目盛りと基準線も表示しない】
// 両端をクリックで0へ戻す操作は通常の状態なので、0除算による不正な位置を生成しない。
test('returns no ticks for collapsed ranges including float32 rounding', () => {
	assert.deepEqual(createImageValueAxisTicks('linear', { minimum: 0, maximum: 0 }), []);
	assert.deepEqual(createImageValueAxisTicks('linear', { minimum: 1, maximum: 1 + Number.EPSILON }), []);
});

// 【GPUの元範囲から導出したズーム範囲は、再度float32へ丸めずに目盛りを作る】
// 描画では正規化した値の窓を使うため、表示単位の両端がfloat32で同じでも拡大領域は有効である。
// 元のCustom範囲に対する空表示の規約は引き続き守る。
test('retains derived viewport ticks within one float32 step', () => {
	const range = { minimum: 1.00000004, maximum: 1.00000005 };
	assert.deepEqual(createImageValueAxisTicks('linear', range), []);
	const ticks = createImageValueAxisTicks('linear', range, 'float64');
	assert.equal(ticks[0].label, '1.00000004');
	assert.equal(ticks.at(-1).label, '1.00000005');
	assert.equal(ticks[0].position, 0);
	assert.equal(ticks.at(-1).position, 1);
});
