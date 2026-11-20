import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEffectTimingHarness } from './helpers/effect-timing.mjs';

const historyEffects = ['timePatchwork', 'regionTimeShift', 'temporalPixelSort'];

async function createHistoryHarness(t, effectId, overrides = {}) {
	const harness = await createEffectTimingHarness(effectId, { historyFrames: 31, maxDelay: 500, historyDuration: 500, ...overrides });
	t.after(harness.dispose);
	return harness;
}

// 【履歴のテストには評価済みの値を渡す】
// GPUのスタブはuniformの成分を検証しない。テスト用の入力がBindingに戻ると、同じ履歴テストでも実際とは異なる入力を使ってしまう。
test('passes scalar and color defaults as values to the timing harness', async t => {
	const harness = await createHistoryHarness(t, 'timePatchwork');
	assert.equal(harness.params.delayMap, 1);
	assert.deepEqual(harness.params.input, [0, 0, 0, 0]);
});

for (const effectId of historyEffects) {
	// 【丸められた時刻でも60fpsの保存を欠落させない】
	// 0.1ms単位の時計ではフレーム時刻が境界の直前になる。浮動小数点の誤差も含め、
	// 保存と同じ頻度で描画できているのに履歴が間引かれる問題を再現する。
	test(`${effectId} captures every frame at matching rates with rounded timestamps`, async t => {
		for (const round of [time => time, time => Math.round(time * 10) / 10]) {
			const harness = await createHistoryHarness(t, effectId);
			for (let index = 0; index <= 600; index++) {
				assert.equal(harness.render(round(index * 1000 / 60)).capturedLayers.length, 1, `frame ${index}`);
			}
		}
	});

	// 【描画間隔と保存間隔が割り切れなくても保存周期を維持する】
	// 実際の保存時刻から次の間隔を測ると、描画待ちの端数が毎回累積して保存数が減る。
	// 高頻度の描画と、少ない履歴枚数の両方で10秒間の保存数を確かめる。
	test(`${effectId} preserves the capture rate between non-divisible render intervals`, async t => {
		for (const { fps, historyFrames, expected } of [{ fps: 144, historyFrames: 31, expected: 601 }, { fps: 60, historyFrames: 8, expected: 141 }]) {
			const harness = await createHistoryHarness(t, effectId, { historyFrames });
			let captures = 0;
			for (let index = 0; index <= fps * 10; index++) captures += harness.render(index * 1000 / fps).capturedLayers.length;
			assert.equal(captures, expected);
		}
	});

	// 【複数周期をまたいだ境界直前の保存も一度だけ行う】
	// 判定の許容誤差を次の予定時刻の計算にも適用しないと、通過済みの境界が残り、
	// 直後にもう一度保存される。中断中の画像を埋めず、元の周期へ復帰する。
	test(`${effectId} skips missed deadlines without capturing the same deadline twice`, async t => {
		const harness = await createHistoryHarness(t, effectId, { historyFrames: 6 });
		const times = [0, 299.8, 300.3, 400];
		assert.deepEqual(times.filter(time => harness.render(time).capturedLayers.length > 0), [0, 299.8, 400]);
	});

	// 【短い保存間隔でも許容誤差で複数周期を先取りしない】
	// 式から非常に短い履歴範囲を指定できるため、0.5msを無条件で加えてはいけない。
	// 0.2ms周期では猶予を0.1msまでに抑え、予定より大きく早い保存を防ぐ。
	test(`${effectId} limits capture tolerance to half the interval`, async t => {
		const harness = await createHistoryHarness(t, effectId, { historyFrames: 6, maxDelay: 1, historyDuration: 1 });
		const times = [0, 0.05, 0.11, 0.21, 0.31];
		assert.deepEqual(times.filter(time => harness.render(time).capturedLayers.length > 0), [0, 0.11, 0.31]);
	});

	// 【停止中の編集で保存周期を先送りしない】
	// Time PatchworkとRegion Time Shiftは停止中に最新画像を保存し、Temporal Pixel Sortは
	// 保存しない。どちらも再描画回数でリングを押し流したり次の保存予定を消費したりしない。
	test(`${effectId} preserves its paused capture policy and the pending deadline`, async t => {
		const harness = await createHistoryHarness(t, effectId, { historyFrames: 6 });
		assert.deepEqual(harness.render(0).capturedLayers, [0]);
		assert.deepEqual(harness.render(50).capturedLayers, []);
		const pausedLayers = effectId === 'temporalPixelSort' ? [] : [1];
		assert.deepEqual(harness.render(50).capturedLayers, pausedLayers);
		assert.deepEqual(harness.render(50).capturedLayers, pausedLayers);
		assert.equal(harness.render(100).capturedLayers.length, 1);
		assert.equal(harness.render(150).capturedLayers.length, 0);
		assert.equal(harness.render(200).capturedLayers.length, 1);
	});

	// 【保存間隔の変更と履歴リセット後は新しい条件から保存する】
	// 長い間隔の予定時刻を残すと、設定変更後やリセット後の履歴が更新されなくなる。
	// 間隔0は描画ごとの保存であり、次の非ゼロ間隔も最後の保存時刻から始める。
	test(`${effectId} updates deadlines when the interval changes or history resets`, async t => {
		const harness = await createHistoryHarness(t, effectId, { historyFrames: 6 });
		harness.render(0);
		harness.params.maxDelay = harness.params.historyDuration = 100;
		assert.equal(harness.render(20).capturedLayers.length, 1);
		harness.params.maxDelay = harness.params.historyDuration = 0;
		assert.equal(harness.render(21).capturedLayers.length, 1);
		assert.equal(harness.render(22).capturedLayers.length, 1);
		harness.params.maxDelay = harness.params.historyDuration = 500;
		assert.equal(harness.render(100).capturedLayers.length, 0);
		assert.equal(harness.render(122).capturedLayers.length, 1);
		harness.params.reset = true;
		assert.deepEqual(harness.render(130).capturedLayers, [0]);
		harness.params.reset = false;
		assert.equal(harness.render(200).capturedLayers.length, 0);
		assert.deepEqual(harness.render(230).capturedLayers, [1]);
		harness.params.historyScale = 50;
		assert.deepEqual(harness.render(240).capturedLayers, [0]);
		assert.equal(harness.render(300).capturedLayers.length, 0);
		assert.deepEqual(harness.render(340).capturedLayers, [1]);
	});
}

// 【遅延画像の古さは予定時刻ではなく実際の保存時刻から求める】
// 周期を保つための予定時刻を履歴のタイムスタンプにすると、補間や遅延量が実際の画像とずれる。
test('history ages retain actual capture timestamps', async t => {
	for (const effectId of ['timePatchwork', 'regionTimeShift']) {
		const harness = await createHistoryHarness(t, effectId, { historyFrames: 6 });
		harness.render(0);
		harness.render(120);
		const { uniforms } = harness.render(150);
		assert.ok(Math.abs(uniforms.historyAges[uniforms.newestLayer] - 0.03) < 0.000001);
	}
});

// 【Region Time Shiftはシーク時に履歴と保存予定を一緒に破棄する】
// 過去の再生区間の締切を残すと、逆方向のシーク先で保存が止まってしまう。
test('Region Time Shift restarts capture scheduling after a seek', async t => {
	const harness = await createHistoryHarness(t, 'regionTimeShift', { historyFrames: 6 });
	assert.deepEqual(harness.render(1000).capturedLayers, [0]);
	assert.deepEqual(harness.render(1100).capturedLayers, [1]);
	assert.deepEqual(harness.render(100, 0).capturedLayers, [0]);
	assert.deepEqual(harness.render(200).capturedLayers, [1]);
});

async function createDatamoshHarness(t, resetInterval = 1) {
	const harness = await createEffectTimingHarness('datamosh', { resetInterval });
	t.after(harness.dispose);
	return harness;
}

// 【Datamoshの1秒周期を浮動小数点の誤差で1フレーム遅らせない】
// 0.1秒の加算は1秒よりわずかに小さくなるため、厳密比較では1100msごとのリセットになる。
test('Datamosh resets on the intended boundary despite floating-point accumulation', async t => {
	const harness = await createDatamoshHarness(t);
	const resetTimes = [];
	for (let time = 0; time <= 3000; time += 100) if (harness.render(time).uniforms.reset === 1) resetTimes.push(time);
	assert.deepEqual(resetTimes, [0, 1000, 2000, 3000]);
});

// 【Datamoshは遅れたリセットの端数を持ち越す】
// 描画時刻へ毎回周期を合わせ直すとリセットが徐々に遅れる。境界をわずかに先取りした場合も
// 次の周期を早めず、長い中断では過去のリセットを停止中の再描画へ持ち越さない。
test('Datamosh retains reset phase through late frames and rounded boundaries', async t => {
	const harness = await createDatamoshHarness(t);
	const times = [0, 1100, 2000, 2999.8, 3000.2, 6500, 6500, 7000];
	assert.deepEqual(times.filter(time => harness.render(time).uniforms.reset === 1), [0, 1100, 2000, 2999.8, 6500, 7000]);
});

// 【Datamoshの手動リセットは新しい周期の開始とし、間隔0では自動リセットしない】
// 自動リセットの余りを手動操作まで引き継ぐと、操作直後に予期せず再びリセットされる。
test('Datamosh starts a new period on manual reset and supports disabled automatic resets', async t => {
	const harness = await createDatamoshHarness(t);
	assert.equal(harness.render(0).uniforms.reset, 1);
	harness.params.reset = true;
	assert.equal(harness.render(700).uniforms.reset, 1);
	harness.params.reset = false;
	assert.equal(harness.render(1000).uniforms.reset, 0);
	assert.equal(harness.render(1700).uniforms.reset, 1);
	harness.params.resetInterval = 0;
	assert.equal(harness.render(5000).uniforms.reset, 0);
});
