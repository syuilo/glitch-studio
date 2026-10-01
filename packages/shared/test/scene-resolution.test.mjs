import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSceneBaseResolution, resolveSceneResolution, validateSceneResolution } from '../src/timeline/scene-resolution.ts';

// 【基準寸法を維持したまま、各Sceneに描画倍率を一度だけ適用する】
// customもプレビュー・書き出し倍率に追従する。親の計算用寸法を子へ渡してしまうと、
// projectの参照先が変わったり、入れ子の深さに応じて繰り返し縮小されてしまう。
test('resolves project and custom scene sizes from their unscaled bases', () => {
	const project = { width: 1920, height: 1080 };
	const custom = { mode: 'custom', width: 513, height: 257 };
	assert.deepEqual(getSceneBaseResolution(custom, project), { width: 513, height: 257 });
	assert.deepEqual(resolveSceneResolution(custom, project, 0.5, 8192), { width: 257, height: 129 });
	assert.deepEqual(resolveSceneResolution(custom, project, 2, 8192), { width: 1026, height: 514 });
	assert.deepEqual(resolveSceneResolution({ mode: 'project' }, project, 2, 8192), { width: 3840, height: 2160 });
	assert.deepEqual(resolveSceneResolution({ mode: 'custom', width: 1, height: 1 }, project, 0.25, 8192), { width: 1, height: 1 });
});

// 【保存する寸法と、倍率適用後のGPU上限をそれぞれ検証する】
// 不正な保存値を丸めて受理しない。指定値が小さくても、書き出し倍率で上限を超えたら
// GPUテクスチャを作る前に失敗させ、暗黙の縮小による画質変更を防ぐ。
test('rejects invalid settings and scaled dimensions exceeding the device limit', () => {
	for (const width of [0, -1, 0.5, Infinity, NaN]) {
		assert.throws(() => validateSceneResolution({ mode: 'custom', width, height: 1 }));
	}
	for (const setting of [undefined, {}, { mode: 'context' }]) assert.throws(() => validateSceneResolution(setting));
	assert.throws(() => resolveSceneResolution({ mode: 'custom', width: 5000, height: 1 }, { width: 1, height: 1 }, 2, 8192), /8192/);
	assert.throws(() => resolveSceneResolution({ mode: 'project' }, { width: 1, height: 1 }, 0, 8192), /positive/);
});
