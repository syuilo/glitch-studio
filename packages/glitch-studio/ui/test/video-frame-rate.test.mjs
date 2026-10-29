import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/utility/video-frame-rate.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
});

function fixture(options = {}) {
	let disposed = 0;
	const track = { async computeFrameRateMetrics() {
		if (options.error === true) throw new Error('Cannot read timestamps');
		return { bestGuessFrameRate: options.frameRate ?? 60, probedPacketCount: options.packetCount ?? 256 };
	} };
	const mediabunny = {
		ALL_FORMATS: [], BlobSource: class {},
		Input: class {
			async getPrimaryVideoTrack() { return options.missingTrack === true ? null : track; }
			dispose() { disposed++; }
		},
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => name === 'mediabunny' ? mediabunny : require(name), module, module.exports);
	return { read: () => module.exports.readVideoFrameRate(new Blob()), disposed: () => disposed };
}

// 【整数fpsと小数fpsを丸めずに読み取り、コンテナを解放する】
// 29.97fpsなどを30fpsに丸めると動画とプロジェクトのフレーム境界が徐々にずれるため、
// 推定された代表値を精度を落とさずに使えることを保証する。
test('preserves integer and fractional video frame rates', async () => {
	for (const frameRate of [24, 60, 30000 / 1001, 60000 / 1001]) {
		const source = fixture({ frameRate });
		assert.equal(await source.read(), frameRate);
		assert.equal(source.disposed(), 1);
	}
});

// 【推定不能な動画では既定fpsを使えるようにnullを返す】
// 単一フレームではトラックの時刻精度がfpsとして返り得るため、推定値が正でも採用しない。
// 読み取り失敗や不正な数値でも動画を開く操作全体を失敗させず、リソースは必ず解放する。
test('returns null for unavailable or invalid frame rates and disposes failed reads', async () => {
	for (const options of [
		{ frameRate: 0 }, { frameRate: -1 }, { frameRate: NaN }, { frameRate: Infinity },
		{ packetCount: 0 }, { packetCount: 1 }, { missingTrack: true }, { error: true },
	]) {
		const source = fixture(options);
		assert.equal(await source.read(), null);
		assert.equal(source.disposed(), 1);
	}
});
