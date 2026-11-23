import { testNodesEffect } from './helpers/nodes-effect.mjs';
import { i18nPlugin } from './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ref } from 'vue';

const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), contents: `
	export { createNodesEffectDropActions } from './utility/nodes-effect-drop-actions.ts';
	export { createNodesEffectAssetNode } from './utility/nodes-effect-asset-node.ts';
	export { COMMAND_DEFS } from './commands.ts'; export { UndoRedo } from './utility/undo-redo.ts';` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'nodes-effect-drop-dependencies', setup(build) {
		build.onResolve({ filter: /\/api\.ts$|ui\.ts$|preferences\.ts$/ }, ({ path }) => ({ path, external: true }));
	} }],
});

function fixture(t, inline = false) {
	t.mock.method(console, 'log', () => {});
	const events = [];
	let dialogs = 0;
	const api = { selectMediaFiles: async options => options.files, openMediaFile: async options => {
		assert.equal(dialogs, 1);
		assert.equal(options.allowAnyFile, true);
		return options.files.map(file => ({ name: file.name, type: file.type, fileData: file,
			width: 100, height: 100, hash: file.name, thumbnailSequence: null, sourceFilePath: null }));
	} };
	const ui = { progress() {
		dialogs++; events.push('progress');
		return { setProgress: value => events.push(['progress', value]), setSubProgress() {}, setText: value => events.push(['text', value]),
			done: () => { dialogs--; events.push('done'); } };
	}, alert: async options => { assert.equal(dialogs, 0); events.push(['alert', options.text]); } };
	const require = createRequire(import.meta.url);
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(path => /\/api\.ts$/.test(path) ? api : /ui\.ts$/.test(path) ? ui
		: /preferences\.ts$/.test(path) ? { preferences: { s: { forceTypeSafety: true } } } : /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/.test(path) ? { nativeEffectDefinitions: {} } : require(path), module, module.exports);
	const { createNodesEffectDropActions, createNodesEffectAssetNode, COMMAND_DEFS, UndoRedo } = module.exports;
	const nodesEffect = testNodesEffect({ nodes: [{ id: 'old', type: 'effect', effectSource: { type: 'nativeEffect', id: 'fill' }, params: {} }],
		outputSources: { output: { nodeId: 'old', outputPort: 'output' } } });
	const state = { assets: ref([]), nodesEffects: ref(inline ? [] : [{ id: 'nodes-effect', definition: nodesEffect }]),
		timelineScenes: ref([{ id: 'scene', layers: inline ? [{ id: 'inline', layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: nodesEffect } }] : [] }]) };
	const history = new UndoRedo(state, COMMAND_DEFS);
	history.onChange(changes => events.push(['commit', dialogs, changes]));
	const target = inline ? { sceneId: 'scene', layerId: 'inline' } : { nodesEffectId: 'nodes-effect' };
	const currentNodesEffect = inline ? state.timelineScenes.value[0].layers[0].effectSource.nodesEffect : state.nodesEffects.value[0].definition;
	const actions = createNodesEffectDropActions({ projectSessionId: 'test-session', context: { stateManager: history }, target, isActive: () => true, revealAssets: () => events.push('revealAssets') });
	return { state, history, actions, nodesEffect: currentNodesEffect, target, events, api, createNodesEffectAssetNode };
}

// 【混在するファイルを取り込み、対応ノードを入力順に末尾へ追加して一度にUndoする】
// 画像だけをノードにし、動画・音声を受け付けず、フォント・アーカイブはAssetsに残す。配線と出力ノードの位置は保持する。
// 読み込みからCommand反映まで一つの進捗ダイアログを維持し、RedoでもIDと設定を変えない。
test('imports only image nodes from mixed files with one undo and preserves existing wiring', async t => {
	const f = fixture(t);
	const files = [new File(['image'], 'photo.png', { type: 'image/png' }), new File(['video'], 'movie.mp4', { type: 'video/mp4' }),
		new File(['audio'], 'sound.wav', { type: 'audio/wav' }), new File(['font'], 'font.ttf', { type: 'font/ttf' }),
		new File(['archive'], 'archive.zip', { type: 'application/zip' })];
	assert.equal(await f.actions.dropFiles(files), true);
	assert.deepEqual(f.nodesEffect.nodes.map(node => node.effectSource.id), ['fill', 'image']);
	const nodes = f.nodesEffect.nodes.slice(1, 4);
	assert.equal(nodes[0].staticSettings.image, f.state.assets.value[0].id);
	assert.equal(nodes[0].params.fit.value, 'cover');
	assert.equal(f.state.assets.value.length, 3);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.ok(f.events.includes('revealAssets'));
	assert.equal(f.events.filter(event => event === 'progress').length, 1);
	assert.equal(f.events.find(event => Array.isArray(event) && event[0] === 'commit')[1], 1);
	assert.deepEqual(f.nodesEffect.outputSources.output, { nodeId: 'old', outputPort: 'output' });
	const ids = nodes.map(node => node.id);
	f.history.undo();
	assert.deepEqual(f.nodesEffect.nodes.map(node => node.id), ['old']);
	assert.equal(f.state.assets.value.length, 0);
	f.history.redo();
	assert.deepEqual(f.nodesEffect.nodes.slice(1, 4).map(node => node.id), ids);
});


// 【インラインNodes Effectも登録済みと同じ素材追加を行う】
// タイムラインのレイヤーを新しく作らず、親から渡されたSceneとレイヤーの保存先だけを更新する。
// 保存先がインラインの場合も、既存Assetの配置では進捗ダイアログを表示しない。
test('adds asset nodes to the selected inline Nodes Effect', async t => {
	const f = fixture(t, true);
	f.state.assets.value.push({ id: 'image', name: 'Image', fileDataType: 'image/png', fileData: new Blob() });
	assert.equal(await f.actions.dropAsset('image'), true);
	assert.equal(f.state.timelineScenes.value[0].layers.length, 1);
	assert.equal(f.nodesEffect.nodes[1].effectSource.id, 'image');
	assert.equal(f.events.includes('progress'), false);
	assert.ok(f.events.find(event => Array.isArray(event) && event[0] === 'commit')[2].some(change => change.type === 'nodesEffect' && change.target.layerId === 'inline'));
	f.history.undo();
	assert.deepEqual(f.nodesEffect.nodes.map(node => node.id), ['old']);
});

// 【読み込み中に対象が置き換わった場合、新しいNodes Effectに古いドロップを適用しない】
// 素材の取り込み自体は残してAssetsを開き、開始時と同じIDでも別の定義にはノードを追加しない。
test('retains imported assets without adding nodes after the target is replaced', async t => {
	const f = fixture(t);
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const read = f.api.openMediaFile;
	f.api.openMediaFile = async options => { await gate; return read(options); };
	const dropped = f.actions.dropFiles([new File([], 'photo.png', { type: 'image/png' })]);
	f.state.nodesEffects.value = [{ id: 'nodes-effect', definition: testNodesEffect() }];
	release();
	assert.equal(await dropped, false);
	assert.equal(f.state.assets.value.length, 1);
	assert.equal(f.state.nodesEffects.value[0].definition.nodes.length, 0);
	assert.ok(f.events.includes('revealAssets'));
});

// 【ノード参照の検証が失敗した取り込みでは、Assetだけを追加しない】
// バッチの後半が無効でも、部分追加を残さず、Undo履歴を増やさない。
test('validates all node references before importing any resources', t => {
	const f = fixture(t);
	const image = { id: 'image', name: 'Image', fileDataType: 'image/png', fileData: new Blob() };
	const first = f.createNodesEffectAssetNode(image);
	const second = { ...first, id: 'bad', staticSettings: { image: 'missing' } };
	assert.throws(() => f.history.commit('insertImportedAssets', { assets: [image], nodesEffect: { target: f.target, nodes: [first, second] } }), /Image asset not found/);
	assert.equal(f.state.assets.value.length, 0);
	assert.deepEqual(f.nodesEffect.nodes.map(node => node.id), ['old']);
	assert.equal(f.history.undoStack.value.length, 0);
});
