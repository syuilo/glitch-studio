import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveEffectParameterValue } from '@gs/subsystems_effect_renderer/effect-parameter-value.ts';

// 【Asset参照を種類に対応する借用リソースへ変換する】
// ノードとエフェクトレイヤーで、同じIDの解決結果や参照切れの扱いが変わらないようにする。
// リソース自体を複製するとGPUTextureや素材データの所有権が壊れるため、同一参照であることも確認する。
test('borrows matching asset resources and returns null for missing or incompatible references', () => {
	const texture = { width: 640, height: 360 };
	const video = { id: 'video', fileDataType: 'video/mp4' };
	const font = { id: 'font', fileDataType: 'font/woff2' };
	const resources = { assets: [video, font], assetTextures: new Map([['image', texture]]) };
	for (const [kind, id, expected] of [['assetReference', 'image', texture], ['videoAssetReference', 'video', video], ['fontAssetReference', 'font', font]]) {
		const def = { dataType: { kind } };
		assert.equal(resolveEffectParameterValue(def, id, resources), expected);
		assert.equal(resolveEffectParameterValue(def, 'missing', resources), null);
		assert.equal(resolveEffectParameterValue(def, null, resources), null);
	}
	assert.equal(resolveEffectParameterValue({ dataType: { kind: 'videoAssetReference' } }, 'font', resources), null);
	assert.equal(resolveEffectParameterValue({ dataType: { kind: 'fontAssetReference' } }, 'video', resources), null);
});

// 【接続可能な定数だけをShaderInputへ変換し、色の乗算境界を揃える】
// 同じ4成分でもcolorは画像、anyはデータであり、canNodeでない値はCPU用のまま渡す。
// 共通化時に全配列をpremultiplyしたり、CPU用の値までラップしたりする回帰を防ぐ。
test('converts shader constants while preserving CPU values and data channels', () => {
	const resources = { assets: [], assetTextures: new Map() };
	const value = [1, 0.5, 0, 0.5];
	const resolve = (kind, canNode, value) => resolveEffectParameterValue({ dataType: { kind }, canNode }, value, resources);
	assert.deepEqual(resolve('color', true, value), { kind: 'uniform', value: [0.5, 0.25, 0, 0.5] });
	assert.deepEqual(resolve('any', true, value), { kind: 'uniform', value });
	assert.deepEqual(resolve('vector', true, [2, 3]), { kind: 'uniform', value: [2, 3] });
	assert.deepEqual(resolve('scalar', true, 2), { kind: 'uniform', value: [2] });
	assert.equal(resolve('color', false, value), value);
	assert.equal(resolve('scalar', false, 2), 2);
	assert.deepEqual(value, [1, 0.5, 0, 0.5]);
});
