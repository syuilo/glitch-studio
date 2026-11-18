import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/utility/custom-node-graph-effect-wire-path.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { getCustomNodeGraphEffectWirePath } = module.exports;

function getPoints(from, to, style = 'curved') {
	return getCustomNodeGraphEffectWirePath(from, to, style).split(/ [ML] /).map(command => {
		const coordinates = command.replace(/^M /, '').split(' ').map(Number);
		assert.equal(coordinates.length, 2);
		assert.ok(coordinates.every(Number.isFinite));
		return coordinates;
	});
}

// 【直線設定は端点をそのままつなぎ、同一点・垂直・極短の接続も有限のパスになる】
// 接続開始時やポインターが出力を横切るときにも、NaNや不必要なループを描画しない。
test('preserves straight connections and handles degenerate curved connections', () => {
	for (const [from, to] of [
		[[10, 20], [400, 300]], [[0, 0], [0, 0]], [[10, 20], [10, 500]],
		[[10, 500], [10, 20]], [[0, 0], [0.001, 0.001]], [[100, 100], [100.0001, 500]],
	]) {
		assert.deepEqual(getPoints(from, to, 'straight'), [from, to]);
		if (Math.abs(to[0] - from[0]) < 0.01) assert.deepEqual(getPoints(from, to), [from, to]);
	}
});

// 【左右・上下の位置関係によらず、下へたわむカテナリーを出力から入力へ描く】
// 端点の並べ替えによって重力方向や配線の始終点が逆転せず、余長も設計値に一致する。
// 折れ線長は真の曲線長より短くなるため、表示用の近似に見合った許容誤差で検証する。
test('sags downward with the intended cable length in all endpoint directions', () => {
	for (const [from, to] of [
		[[10, 20], [410, 20]], [[410, 20], [10, 20]],
		[[10, 20], [410, 320]], [[410, 320], [10, 20]],
		[[10, 320], [410, 20]], [[410, 20], [10, 320]],
		[[-500, -100], [500, 2000]], [[5, 0], [5.02, 5000]],
		[[0, 0], [100000, 50000]],
	]) {
		const points = getPoints(from, to);
		assert.deepEqual(points[0], from);
		assert.deepEqual(points.at(-1), to);
		assert.ok(points.length <= 1025);
		assert.deepEqual(getPoints(to, from), [...points].reverse());
		const dx = to[0] - from[0];
		const dy = to[1] - from[1];
		const distance = Math.hypot(dx, dy);
		const expectedLength = distance + Math.min(distance * 0.08, 32) * (dx / distance) ** 2;
		let length = 0;
		for (let index = 1; index < points.length; index++) {
			const [x, y] = points[index];
			assert.ok((x - points[index - 1][0]) * dx > 0);
			assert.ok(y >= from[1] + dy * (x - from[0]) / dx - 1e-8);
			length += Math.hypot(x - points[index - 1][0], y - points[index - 1][1]);
		}
		assert.ok(Math.abs(length - expectedLength) < 0.5, `${length} vs ${expectedLength}`);
		if (Math.abs(dx) > 1) assert.ok(points.length > 2);
	}
});

// 【描画の線分はカテナリーから0.25px以内に収まる】
// 独立に復元したcosh形の曲線と各線分内を比較し、単に放物線で代用していないことと、
// 中点以外で誤差が大きくなりやすい高低差のある配線の分割精度を確認する。
test('approximates the catenary within the display tolerance', () => {
	for (const [from, to] of [[[0, 0], [400, 0]], [[0, 0], [400, 700]], [[0, 700], [400, 0]]]) {
		const points = getPoints(from, to);
		// x=0, h/2, hの3点のcoshの差分比から形状パラメータを復元する。
		// 真の曲線上の点を生成する実装なので、分割された中点も曲線を一意に定める。
		const middleY = points.find(([x]) => x === 200)[1];
		const sag = middleY - (from[1] + to[1]) / 2;
		const halfHeightDifference = (to[1] - from[1]) / 2;
		let lower = 1;
		let upper = 100000;
		for (let iteration = 0; iteration < 80; iteration++) {
			const scale = (lower + upper) / 2;
			const halfSpan = 200 / scale;
			const predictedSag = Math.hypot(scale, halfHeightDifference / Math.sinh(halfSpan)) * (Math.cosh(halfSpan) - 1);
			if (predictedSag > sag) lower = scale;
			else upper = scale;
		}
		const scale = (lower + upper) / 2;
		const vertex = 200 + scale * Math.asinh((to[1] - from[1]) / (2 * scale * Math.sinh(200 / scale)));
		const offset = from[1] + scale * Math.cosh(vertex / scale);
		for (let index = 1; index < points.length; index++) {
			const start = points[index - 1];
			const end = points[index];
			for (let step = 0; step <= 10; step++) {
				const fraction = step / 10;
				const x = start[0] + (end[0] - start[0]) * fraction;
				const lineY = start[1] + (end[1] - start[1]) * fraction;
				const catenaryY = offset - scale * Math.cosh((x - vertex) / scale);
				assert.ok(Math.abs(catenaryY - lineY) <= 0.250001);
			}
		}
	}
});
