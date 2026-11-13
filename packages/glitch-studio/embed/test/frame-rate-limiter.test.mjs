import assert from 'node:assert/strict';
import { test } from 'node:test';
import { implementation } from './helpers/load.mjs';

const { PortableVisualModuleFrameRateLimiter } = implementation;

// 【自動は高リフレッシュレートや表示周期の変更でもrAFの描画機会をすべて通す】
// 固定FPSからの切り替えで古い待ち時刻を残したり、自動が暗黙の60fps制限になることを防ぐ。
test('follows every animation frame in automatic mode and clears the previous numeric limit', () => {
	const limiter = new PortableVisualModuleFrameRateLimiter();
	assert.equal(limiter.takeFrame(0, 15), true);
	let timestamp = 0;
	for (const refreshRate of [60, 144, 240, 120]) {
		for (let index = 0; index < 120; index++) {
			timestamp += 1000 / refreshRate;
			assert.equal(limiter.takeFrame(timestamp, null), true);
		}
	}
	assert.equal(limiter.takeFrame(timestamp + 1, 30), true);
	assert.equal(limiter.takeFrame(timestamp + 2, 30), false);
});

// 【表示周期と目標FPSが等しい場合、rAF時刻の丸めで不要な間引きをしない】
// 60Hzの約16.67msを厳密比較し、描画時刻へ基準を毎回置き直すと、軽い作品でも約40〜45fpsになる。
// Chromeの時刻に見られる0.1msの丸めを含め、長時間の描画機会を失わないことを確認する。
test('renders every available frame at matching refresh rates despite timestamp rounding', () => {
	for (const refreshRate of [59.94, 60, 120, 144, 240]) {
		const limiter = new PortableVisualModuleFrameRateLimiter();
		for (let index = 0; index < 600; index++) {
			const timestamp = Math.round((123.4 + index * 1000 / refreshRate) * 10) / 10;
			assert.equal(limiter.takeFrame(timestamp, refreshRate), true, `${refreshRate}Hz frame ${index}`);
		}
	}
});

// 【目標FPSが表示周期の整数分の一でなくても、端数を次回へ持ち越す】
// 144Hzで60fpsを指定した際に、毎回3周期待つことで48fpsへ落ちることを防ぐ。
// 描画回数だけを検証し、内部の予定時刻の計算方法には依存しない。
test('maintains the requested average rate across non-divisible display periods', () => {
	for (const refreshRate of [60, 120, 144, 165, 240]) {
		for (const fpsLimit of [24, 29.97, 30, 50, 60]) {
			const limiter = new PortableVisualModuleFrameRateLimiter();
			let rendered = 0;
			for (let index = 0; index < refreshRate * 10; index++) {
				const timestamp = Math.round((17.2 + index * 1000 / refreshRate) * 10) / 10;
				if (limiter.takeFrame(timestamp, fpsLimit)) rendered++;
			}
			assert.ok(Math.abs(rendered - fpsLimit * 10) <= 1, `${refreshRate}Hz / ${fpsLimit}fps: ${rendered} frames`);
		}
	}
});

// 【GPU待ちや非表示で失った描画枠を、復帰後に連続実行しない】
// 古いフレームの追い掛けで入力遅延や負荷を増やさず、停止・再接続・FPS変更はすぐ描画できるようにする。
test('drops missed frames and resets pacing on resume and rate changes', () => {
	const limiter = new PortableVisualModuleFrameRateLimiter();
	assert.equal(limiter.takeFrame(0, 60), true);
	assert.equal(limiter.takeFrame(5000, 60), true);
	for (let index = 0; index < 10; index++) assert.equal(limiter.takeFrame(5000, 60), false);
	assert.equal(limiter.takeFrame(5016.6, 60), true);
	assert.equal(limiter.takeFrame(5017, 30), true);
	assert.equal(limiter.takeFrame(5033.3, 30), false);
	assert.equal(limiter.takeFrame(5050.3, 30), true);
	limiter.reset();
	assert.equal(limiter.takeFrame(5051, 30), true);
	assert.equal(limiter.takeFrame(5052, 30), false);
});
