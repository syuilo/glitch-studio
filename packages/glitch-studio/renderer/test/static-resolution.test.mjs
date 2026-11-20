import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const load = path => loadShaderSource(fileURLToPath(import.meta.resolve(path)));
const { getPlayerIntrinsicResolution } = await load('@gs/glitch-studio_shared/player-resolution.ts');
// 【Playerは現在のフレーム寸法ではなく素材の保存済みメタデータを参照する】
// Webcamなどのライブ入力は固有寸法を宣言せず、呼び出し側のcontextへ委ねる。
test('gets file Player dimensions from metadata and leaves live Players context-sized', () => {
	const players = [{ id: 'file', sourceType: 'asset', assetId: 'movie' }, { id: 'live', sourceType: 'webcam' }];
	const assets = [{ id: 'movie', width: 640, height: 360 }];
	assert.deepEqual(getPlayerIntrinsicResolution('file', players, assets), { width: 640, height: 360 });
	assert.equal(getPlayerIntrinsicResolution('live', players, assets), null);
	assets[0] = { ...assets[0], width: 320, height: 240 };
	assert.deepEqual(getPlayerIntrinsicResolution('file', players, assets), { width: 320, height: 240 });
});
