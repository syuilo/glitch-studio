import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { createProjectScriptQueries } from './src/scripting/project-script-queries.ts';
		export { SCRIPT_COMMAND_NAMES } from './src/scripting/script-command-names.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
	` },
	plugins: [{ name: 'script-query-effects', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', contents: `
			export const effectDefinitions = {
				fill: {
					id: 'fill', displayName: 'Fill', description: { 'ja-JP': '塗りつぶし', 'en-US': 'Fill' },
					kind: 'generate', dependsOnRenderHistory: false, tags: ['color'],
					paramDefs: { color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } } },
					primaryInputParameter: null, resolutionInputParameters: [],
					outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output',
				},
			};
		` }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { createProjectScriptQueries, SCRIPT_COMMAND_NAMES, COMMAND_DEFS, UndoRedo } = loaded.exports;

function fixture() {
	const state = {
		name: { value: 'Project' }, description: { value: '' }, author: { value: '' },
		resolution: { value: { width: 1920, height: 1080 } }, timelineFps: { value: 30 },
		timelineMotionBlur: { value: { enabled: false } }, exportSettings: { value: null },
		automationGraphs: { value: [] }, customShaderEffects: { value: [] },
		assets: { value: [] }, players: { value: [] }, visualModules: { value: [] }, timelineScenes: { value: [] },
	};
	return { state, manager: new UndoRedo(state, COMMAND_DEFS), query: createProjectScriptQueries(state) };
}

// 【一覧の対象参照で登録済みとインラインのVisual Moduleを同じ手順で編集できる】
// スクリプトに内部の所在変換を要求せず、Queryから得た参照を直接Commandへ渡せることを確認する。
// 取得済みデータの書き換えは状態に反映せず、再取得は直前のCommandの結果を返す。
test('queries registered and inline Visual Modules using references accepted by Commands', () => {
	const { state, manager, query } = fixture();
	const registeredTarget = manager.commit('createVisualModule', { name: 'Registered' });
	const sceneTarget = manager.commit('createTimelineScene', { name: 'Scene' });
	const layerTarget = manager.commit('createTimelineLayer', { ...sceneTarget, layer: { layerType: 'inlineVisualModule', name: 'Inline' } });
	const inlineTarget = { sceneId: sceneTarget.sceneId, inlineVisualModuleLayerId: layerTarget.layerId };
	assert.deepEqual(query['Query:listVisualModules'](), [
		{ target: registeredTarget, name: 'Registered' }, { target: inlineTarget, name: 'Inline' },
	]);
	for (const visualModuleTarget of [registeredTarget, inlineTarget]) {
		const nodeTarget = manager.commit('createVisualModuleEffectNode', { visualModule: visualModuleTarget, effectId: 'fill' });
		const listedNode = query['Query:listNodes'](visualModuleTarget).find(node => node.type === 'effect');
		assert.deepEqual(listedNode.target, nodeTarget);
		const node = query['Query:getNode'](listedNode.target);
		node.params.color.value[0] = 0.25;
		assert.equal(query['Query:getNode'](listedNode.target).params.color.value[0], 1);
		manager.commit('setVisualModuleNodeParameterSource', { target: listedNode.target, parameterPath: ['color'], source: { inputSource: 'literal', value: [0.5, 0, 0, 1] } });
		assert.deepEqual(query['Query:getNode'](listedNode.target).params.color.value, [0.5, 0, 0, 1]);
		const visualModule = query['Query:getVisualModule'](visualModuleTarget);
		assert.deepEqual(visualModule.target, visualModuleTarget);
		visualModule.nodes.length = 0;
		assert.ok(query['Query:getVisualModule'](visualModuleTarget).nodes.length > 0);
	}
	assert.equal(state.visualModules.value.length, 1);
});

// 【Timelineの一覧は階層を失わず、クリップやパラメータの所在を編集APIへ引き渡せる】
// 親レイヤーの下にある対象も列挙し、別Sceneの内容は辿らない。パラメータ群の名前は
// Commandに合わせ、Visual Module引数をmoduleという別名で公開しない。
test('lists nested Timeline layers and exposes clip timing and parameter groups', () => {
	const { manager, query } = fixture();
	const scene = manager.commit('createTimelineScene', { name: 'Scene' });
	const textLayer = manager.commit('createTimelineLayer', {
		...scene, layer: { layerType: 'text', name: 'Caption' }, clips: [{ startMs: 100, durationMs: 900, contentOffsetMs: 0 }],
	});
	const container = manager.commit('wrapTimelineLayers', { ...scene, layerIds: [textLayer.layerId], containerType: 'folder', name: 'Folder' });
	const visualModuleLayer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'inlineVisualModule' } });
	const listedLayers = query['Query:listTimelineLayers'](scene);
	assert.equal(listedLayers.find(layer => layer.target.layerId === textLayer.layerId).parentLayerId, container.layerId);
	assert.equal(listedLayers.find(layer => layer.target.layerId === container.layerId).parentLayerId, null);
	assert.deepEqual(query['Query:listTimelineClips'](container), []);
	const [clip] = query['Query:listTimelineClips'](textLayer);
	assert.deepEqual(query['Query:getTimelineClip'](clip.target), clip);
	assert.equal(clip.startMs, 100);
	clip.startMs = 999;
	assert.equal(query['Query:getTimelineClip'](clip.target).startMs, 100);
	const layerParameters = query['Query:getTimelineLayerParameters'](visualModuleLayer);
	assert.ok(Object.hasOwn(layerParameters, 'visualModule'));
	assert.equal(Object.hasOwn(layerParameters, 'module'), false);
	assert.ok(Object.hasOwn(layerParameters.compositing, 'definitions'));
	assert.deepEqual(query['Query:getTimelineLayer'](textLayer).target, textLayer);
	assert.deepEqual(query['Query:getTimelineScene'](scene).target, scene);
});

// 【素材取得ではバイナリを公開せず、定義の取得結果を変更しても共通定義を汚さない】
// File/BlobやサムネイルはAiScript値に変換できず、プロジェクトの内容参照にも不要である。
// Effectの既定値は複数ノードが共有するため、戻り値を通した書き換えを防ぐ。
test('returns asset metadata without binary data and detached effect definitions', () => {
	const { state, query } = fixture();
	state.assets.value.push({ id: 'asset', name: 'Image', width: 100, height: 50, fileDataType: 'image/png', fileData: new Blob(['image']), isExternalReference: false, sourceFilePath: null,
		thumbnailSequence: { width: 10, height: 5, frames: [{ timestampSeconds: 0, fileData: new Blob(['thumbnail']) }] } });
	const [asset] = query['Query:listAssets']();
	assert.deepEqual(query['Query:getAsset'](asset.target), asset);
	assert.equal(Object.hasOwn(asset, 'fileData'), false);
	assert.equal(Object.hasOwn(asset, 'thumbnailSequence'), false);
	asset.name = 'Local change';
	assert.equal(query['Query:getAsset'](asset.target).name, 'Image');
	const [effect] = query['Query:listEffects']();
	const definition = query['Query:getEffect'](effect.target);
	assert.equal(definition.primaryOutput, 'output');
	definition.paramDefs.color.defaultValue.value[0] = 42;
	assert.equal(query['Query:getEffect'](effect.target).paramDefs.color.defaultValue.value[0], 1);
	const project = query['Query:getProject']();
	project.resolution.width = 1;
	assert.equal(state.resolution.value.width, 1920);
});

// 【不正・削除済みの対象は明示的に失敗し、偶然一致する別の対象へ読み替えない】
// スクリプトでは対象の取り違えを後続の編集前に発見する必要がある。Effectの予約的な
// プロパティ名も定義として受け入れず、prototype由来の値を返さない。
test('rejects malformed and missing query targets', () => {
	const { query } = fixture();
	assert.throws(() => query['Query:getVisualModule'](null), /must be an object/);
	assert.throws(() => query['Query:getVisualModule']({ visualModuleId: 123 }), /non-empty string/);
	assert.throws(() => query['Query:getVisualModule']({ visualModuleId: 'missing' }), /not found/);
	assert.throws(() => query['Query:getTimelineScene']({ sceneId: 'missing' }), /not found/);
	assert.throws(() => query['Query:getAsset']({ assetId: 'missing' }), /not found/);
	assert.throws(() => query['Query:getPlayer']({ playerId: 'missing' }), /not found/);
	assert.throws(() => query['Query:getEffect']({ effectId: 'toString' }), /not found/);
	assert.throws(() => query['Query:getEffect']({ effectId: '__proto__' }), /not found/);
});

// 【公開Commandは実在する編集操作に限定し、素材の取り込み用内部入力を公開しない】
// 公開一覧の綴り違いや重複は実行時まで発覚しにくい。上位アプリ操作やBlobを要求する
// 操作をAiScriptへ渡さず、既存素材の利用・名前変更・削除は引き続き可能にする。
test('publishes existing data-based Commands without import or application operations', () => {
	assert.equal(new Set(SCRIPT_COMMAND_NAMES).size, SCRIPT_COMMAND_NAMES.length);
	for (const name of SCRIPT_COMMAND_NAMES) assert.ok(Object.hasOwn(COMMAND_DEFS, name), name);
	for (const name of ['createVisualModule', 'createTimelineLayer', 'setVisualModuleNodeParameterSource', 'setTimelineLayerParameterSource', 'setAssetName', 'removeAsset']) {
		assert.ok(SCRIPT_COMMAND_NAMES.includes(name), name);
	}
	for (const name of ['createAsset', 'replaceAssetSource', 'insertImportedAssets', 'insertVisualModuleAssetNodes', 'insertTimelineAssetLayers', 'importVisualModule', 'insertCustomShaderEffect', 'setExportSettings', 'saveProject', 'undo', 'redo']) {
		assert.equal(SCRIPT_COMMAND_NAMES.includes(name), false, name);
	}
});
