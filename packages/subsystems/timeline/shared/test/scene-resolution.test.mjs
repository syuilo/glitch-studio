import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getSceneBaseResolution, resolveSceneResolution } = await loadSource(fileURLToPath(new URL('../src/scene-resolution.ts', import.meta.url)));

// 【基準寸法を維持したまま、各Sceneに描画倍率を一度だけ適用する】
// customもプレビュー・書き出し倍率に追従する。親の計算用寸法を子へ渡してしまうと、
// projectの参照先が変わったり、入れ子の深さに応じて繰り返し縮小されてしまう。
test('resolves project and custom scene sizes from their unscaled bases', () => {
	const project = { width: 1920, height: 1080 };
	const custom = { mode: 'customAbsolute', width: 513, height: 257 };
	assert.deepEqual(getSceneBaseResolution(custom, project), { width: 513, height: 257 });
	assert.deepEqual(resolveSceneResolution(custom, project, 0.5), { width: 257, height: 129 });
	assert.deepEqual(resolveSceneResolution(custom, project, 2), { width: 1026, height: 514 });
	assert.deepEqual(resolveSceneResolution({ mode: 'project' }, project, 2), { width: 3840, height: 2160 });
	assert.deepEqual(resolveSceneResolution({ mode: 'customAbsolute', width: 1, height: 1 }, project, 0.25), { width: 1, height: 1 });
});
