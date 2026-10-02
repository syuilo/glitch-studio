import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const effectNames = (await readdir(new URL('../../shared/src/effect/fx/', import.meta.url)))
	.filter(name => existsSync(new URL(`../../shared/src/effect/fx/${name}/_def_.ts`, import.meta.url)));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { createEffectTimelineLayer } from './src/utility/effect-timeline-layer.ts';
		export { resolveLayerParameter, getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
		export { canConnectNodeDataTypes } from './src/utility/node-outputs.ts';
		export { areNodeDataTypesCompatible } from '../shared/src/utility/node-outputs.ts';
		export { effectDefinitions } from '../shared/src/effect/effect-definitions.ts';
		export { preferences } from './src/preferences.ts';
		export { validateTimelineEffectLayer } from '../shared/src/timeline/effect-layer.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'effect-layer-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			loader: 'ts', resolveDir: uiDirectory,
			contents: path === 'preferences' ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: effectNames.map((name, index) => `import effect${index} from '../shared/src/effect/fx/${name}/_def_.ts';`).join('\n')
				+ `\nexport const effectDefinitions = Object.fromEntries([${effectNames.map((_, index) => `effect${index}`).join(',')}].map(def => [def.id, def]));`,
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, createEffectTimelineLayer, resolveLayerParameter, getLayerKeyframeParameters, effectDefinitions, preferences,
	canConnectNodeDataTypes, areNodeDataTypesCompatible, encodeProjectFile, decodeProjectFile, validateTimelineEffectLayer } = module.exports;
const literal = value => ({ inputSource: 'literal', value });

// 【すべてのエフェクトを既定値のままレイヤーとして作成できる】
// タイムライン向けの候補制限は設けないため、配列・構造体の既定値もレイヤーのBinding制約に従う必要がある。
test('creates every bundled effect without illegal binding defaults', () => {
	for (const definition of Object.values(effectDefinitions)) {
		assert.ok(['generate', 'modify'].includes(definition.kind), definition.id);
		validateTimelineEffectLayer(createEffectTimelineLayer(definition, 0), definition);
	}
});

function fixture(effectId = 'testStructArray') {
	const layer = createEffectTimelineLayer(effectDefinitions[effectId], 100);
	const state = { timelineScenes: { value: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }] }, visualModules: { value: [] }, assets: { value: [] } };
	const target = { sceneId: 'scene', layerId: layer.id, target: 'effect' };
	const edit = (paramPath, edit) => {
		const command = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, paramPath, edit });
		command.execute(state);
		return command;
	};
	return { layer, state, target, edit, read: path => resolveLayerParameter(state, layer, 'effect', path).value };
}

// 【主入力がある生成系と加工系で初期入力・合成を分ける】
// 背景入力の存在だけでGridを加工系にすると背景を二重に合成してしまう。
// リセットはレイヤーとしての初期入力に戻し、共有するエフェクト定義を変更しない。
test('initializes kinds independently of primary input presence and resets the layer input', () => {
	const generated = fixture('grid');
	assert.deepEqual(generated.layer.effectParamValues.background, effectDefinitions.grid.paramDefs.background.defaultValue);
	assert.deepEqual(generated.layer.compositingParamValues.blendMode, literal('normal'));
	const modified = fixture('colorMix');
	assert.deepEqual(modified.read(['inputA']), { inputSource: 'layerInput', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
	assert.deepEqual(modified.layer.compositingParamValues.blendMode, literal('replace'));
	modified.edit(['inputA'], { kind: 'literal', value: [1, 0, 0, 1] });
	const reset = modified.edit(['inputA'], { kind: 'reset' });
	assert.equal(modified.read(['inputA']).inputSource, 'layerInput');
	reset.undo(modified.state);
	assert.deepEqual(modified.read(['inputA']), literal([1, 0, 0, 1]));
	reset.execute(modified.state);
	assert.equal(effectDefinitions.colorMix.paramDefs.inputA.defaultValue.inputSource, 'literal');
	assert.deepEqual(modified.layer.resolution, { mode: 'auto' });
	const noPrimary = createEffectTimelineLayer({ ...effectDefinitions.grid, kind: 'modify', primaryInputParameter: null }, 0);
	assert.equal(noPrimary.effectParamValues.background.inputSource, 'literal');
});

// 【要素の並べ替え・削除・Undo/Redo後もIDパスでキーを扱う】
// キーをレイヤーの別テーブルへ分離せず要素内のBindingに保持し、削除と復元を一つの操作にする。
test('edits nested scene-time keyframes and preserves identity through array operations', () => {
	const f = fixture();
	const path = ['buzzs', 'first', 'x'];
	f.edit(path, { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const binding = f.read(path);
	assert.equal(binding.offsetMode, 'start');
	assert.equal(binding.wrapMode, 'clamp');
	assert.equal(binding.keyframesTimeline.isNormalized, false);
	f.edit(path, { kind: 'keyframesTimelineInline', value: { ...binding, keyframesTimeline: { ...binding.keyframesTimeline,
		keyframes: [{ id: 'key', x: 120.6, value: 0.5, interpolation: { type: 'linear' } }] } } });
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	const add = f.edit(['buzzs'], { kind: 'addElement' });
	const addedId = f.read(['buzzs']).value[1].id;
	add.undo(f.state);
	add.execute(f.state);
	assert.equal(f.read(['buzzs']).value[1].id, addedId);
	f.read(['buzzs']).value.reverse();
	const move = COMMAND_DEFS.moveTimelineKeyframes.create({ sceneId: 'scene', positions: [{ ...f.target, paramPath: path, keyframeId: 'key', x: 400 }] });
	move.execute(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 400);
	move.undo(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	assert.deepEqual(getLayerKeyframeParameters(f.state, f.layer).map(param => param.paramPath), [path]);
	const remove = f.edit(['buzzs'], { kind: 'removeElement', elementId: 'first' });
	assert.equal(getLayerKeyframeParameters(f.state, f.layer).length, 0);
	assert.throws(() => f.edit(path, { kind: 'literal', value: 1 }), /Unknown array element/);
	remove.undo(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	const reset = f.edit(['buzzs'], { kind: 'reset' });
	const resetId = f.read(['buzzs']).value[0].id;
	assert.notEqual(resetId, 'first');
	reset.undo(f.state);
	reset.execute(f.state);
	assert.equal(f.read(['buzzs']).value[0].id, resetId);
});

// 【非主入力の配列要素にも下層入力を設定し、利用スコープと型互換性を分ける】
// forceTypeSafetyを無効にした既存プロジェクトを開けるよう型不一致は許可しつつ、
// canNodeでない末端・コンテナ・合成設定・モジュール内部には下層入力を流さない。
test('supports secondary layer inputs and enforces their scope independently of type preferences', () => {
	const f = fixture();
	const path = ['buzzs', 'first', 'image'];
	f.edit(path, { kind: 'inputSource', inputSource: 'layerInput' });
	f.edit(path, { kind: 'layerInput', value: { ...f.read(path), fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' } });
	assert.equal(f.read(path).filterMode, 'nearest');
	for (const invalid of [['buzzs', 'first', 'x'], ['buzzs']]) assert.throws(() => f.edit(invalid, { kind: 'inputSource', inputSource: 'layerInput' }));
	assert.throws(() => COMMAND_DEFS.editTimelineLayerParam.create({ ...f.target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'inputSource', inputSource: 'layerInput' } }).execute(f.state));
	for (const inputSource of ['node', 'externalCustomParameterInput']) assert.throws(() => f.edit(path, { kind: 'inputSource', inputSource }));
	const input = { kind: 'scalar' };
	preferences.s.forceTypeSafety = false;
	assert.equal(canConnectNodeDataTypes({ kind: 'color' }, input), true);
	assert.equal(areNodeDataTypesCompatible({ kind: 'color' }, input), false);
	preferences.s.forceTypeSafety = true;
	assert.equal(canConnectNodeDataTypes({ kind: 'color' }, input), false);
	for (const kind of ['color', 'any']) assert.equal(canConnectNodeDataTypes({ kind: 'color' }, { kind }), true);
	preferences.s.forceTypeSafety = false;
});

// 【エフェクト・解像度・ネストしたBindingをプロジェクト保存で維持する】
// クリップ追加や解像度変更でもエフェクト種別とパラメータの所有者はレイヤーのままにする。
test('round trips effect layers and changes resolution and clips with undo', async () => {
	const f = fixture();
	f.edit(['buzzs', 'first', 'image'], { kind: 'inputSource', inputSource: 'layerInput' });
	const resolution = COMMAND_DEFS.changeEffectLayerResolution.create({ ...f.target, resolution: { mode: 'customAbsolute', width: 640, height: 360 } });
	resolution.execute(f.state);
	const add = COMMAND_DEFS.addTimelineClip.create({ ...f.target, clip: { id: 'second', startMs: 6000, durationMs: 1000, contentOffsetMs: 50.25 } });
	add.execute(f.state);
	const project = { id: 'project', gsVersion: '2.0.0-alpha', name: 'Test', description: '', author: '', resolution: { width: 800, height: 600 },
		assets: [], players: [], visualModules: [], timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
	resolution.undo(f.state);
	assert.deepEqual(f.layer.resolution, { mode: 'auto' });
	add.undo(f.state);
	assert.equal(f.layer.clips.length, 1);
	assert.equal(f.read(['buzzs', 'first', 'image']).inputSource, 'layerInput');
});
