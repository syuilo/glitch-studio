import { i18nPlugin } from './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ref } from 'vue';

const bundle = await build({ stdin: { loader: 'ts', resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), contents: `
	export { createVisualModuleDropActions } from './utility/visual-module-drop-actions.ts';
	export { createVisualModuleAssetNode } from './utility/visual-module-asset-node.ts';
	export { COMMAND_DEFS } from './commands.ts'; export { UndoRedo } from './utility/undo-redo.ts';` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'visual-module-drop-dependencies', setup(build) {
		build.onResolve({ filter: /\/api\.ts$|ui\.ts$|preferences\.ts$|effect-definitions\.[jt]s$/ }, ({ path }) => ({ path, external: true }));
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
		: /preferences\.ts$/.test(path) ? { preferences: { s: { forceTypeSafety: true } } } : /effect-definitions\.[jt]s$/.test(path) ? { effectDefinitions: {} } : require(path), module, module.exports);
	const { createVisualModuleDropActions, createVisualModuleAssetNode, COMMAND_DEFS, UndoRedo } = module.exports;
	const visualModule = { id: 'visual-module', name: 'Visual Module', paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null,
		nodes: [{ id: 'in', type: 'globalIn' }, { id: 'old', type: 'effect', effectId: 'fill', params: {} },
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'old', outputPort: 'output' } } }] };
	const state = { assets: ref([]), players: ref([]), visualModules: ref(inline ? [] : [visualModule]),
		timelineScenes: ref([{ id: 'scene', layers: inline ? [{ id: 'inline', layerType: 'inlineVisualModule', visualModule }] : [] }]) };
	const history = new UndoRedo(state, COMMAND_DEFS);
	history.onChange(changes => events.push(['commit', dialogs, changes]));
	const target = inline ? { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' } : { visualModuleId: 'visual-module' };
	const currentVisualModule = inline ? state.timelineScenes.value[0].layers[0].visualModule : state.visualModules.value[0];
	const actions = createVisualModuleDropActions({ context: { stateManager: history }, target, isActive: () => true, revealAssets: () => events.push('revealAssets') });
	return { state, history, actions, visualModule: currentVisualModule, target, events, api, createVisualModuleAssetNode };
}

// 【混在するファイルを取り込み、対応ノードを入力順に末尾へ追加して一度にUndoする】
// 画像・動画・音声の参照先とPlayerを揃え、フォント・アーカイブはAssetsに残す。配線と出力ノードの位置は保持する。
// 読み込みからCommand反映まで一つの進捗ダイアログを維持し、RedoでもIDと設定を変えない。
test('imports media nodes in order with one undo and preserves existing wiring', async t => {
	const f = fixture(t);
	const files = [new File(['image'], 'photo.png', { type: 'image/png' }), new File(['video'], 'movie.mp4', { type: 'video/mp4' }),
		new File(['audio'], 'sound.wav', { type: 'audio/wav' }), new File(['font'], 'font.ttf', { type: 'font/ttf' }),
		new File(['archive'], 'archive.zip', { type: 'application/zip' })];
	assert.equal(await f.actions.dropFiles(files), true);
	assert.deepEqual(f.visualModule.nodes.map(node => node.effectId ?? node.type), ['globalIn', 'fill', 'image', 'video', 'audioWaveform', 'globalOut']);
	const nodes = f.visualModule.nodes.slice(2, 5);
	assert.equal(nodes[0].params.image.value, f.state.assets.value[0].id);
	assert.equal(nodes[0].params.fit.value, 'cover');
	assert.equal(nodes[1].params.player.value, f.state.players.value[0].id);
	assert.deepEqual(nodes[2].params.audio.value, { type: 'player', playerId: f.state.players.value[1].id });
	assert.equal(nodes[2].params.channel.value, 'stereo');
	assert.equal(f.state.assets.value.length, 5);
	assert.equal(f.state.players.value.length, 2);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.ok(f.events.includes('revealAssets'));
	assert.equal(f.events.filter(event => event === 'progress').length, 1);
	assert.equal(f.events.find(event => Array.isArray(event) && event[0] === 'commit')[1], 1);
	assert.deepEqual(f.visualModule.nodes.at(-1).inputs.output, { nodeId: 'old', outputPort: 'output' });
	const ids = nodes.map(node => node.id);
	f.history.undo();
	assert.deepEqual(f.visualModule.nodes.map(node => node.id), ['in', 'old', 'out']);
	assert.equal(f.state.assets.value.length, 0);
	assert.equal(f.state.players.value.length, 0);
	f.history.redo();
	assert.deepEqual(f.visualModule.nodes.slice(2, 5).map(node => node.id), ids);
});

// 【既存素材のPlayerを使い、Playerがない素材ではノードとまとめて作成する】
// Assetを再取り込みせず、必要なPlayerだけ増やす。Undoで他ノードが利用する既存Playerを消さない。
// ファイル読み込みのない既存Assetの配置では、進捗ダイアログで操作を止めない。
test('reuses existing players and creates missing players with an atomic node addition', async t => {
	const f = fixture(t);
	f.state.assets.value.push({ id: 'video', name: 'Movie', fileDataType: 'video/mp4', fileData: new Blob() },
		{ id: 'audio', name: 'Sound', fileDataType: 'audio/wav', fileData: new Blob() }, { id: 'font', name: 'Font', fileDataType: 'font/ttf', fileData: new Blob() });
	f.state.players.value.push({ id: 'existing', name: 'Existing', sourceType: 'asset', assetId: 'video' });
	assert.equal(await f.actions.dropAsset('video'), true);
	assert.equal(f.visualModule.nodes[2].params.player.value, 'existing');
	assert.equal(f.state.players.value.length, 1);
	assert.equal(await f.actions.dropAsset('audio'), true);
	assert.equal(f.state.players.value.length, 2);
	assert.equal(f.history.undoStack.value.length, 2);
	f.history.undo();
	assert.deepEqual(f.state.players.value.map(player => player.id), ['existing']);
	assert.equal(f.state.assets.value.length, 3);
	assert.equal(await f.actions.dropAsset('font'), false);
	assert.equal(await f.actions.dropAsset('missing'), false);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.equal(f.events.includes('revealAssets'), false);
	assert.equal(f.events.includes('progress'), false);
});

// 【インラインVisual Moduleも登録済みと同じ素材追加を行う】
// タイムラインのレイヤーを新しく作らず、親から渡されたSceneとレイヤーの保存先だけを更新する。
// 保存先がインラインの場合も、既存Assetの配置では進捗ダイアログを表示しない。
test('adds asset nodes to the selected inline Visual Module', async t => {
	const f = fixture(t, true);
	f.state.assets.value.push({ id: 'image', name: 'Image', fileDataType: 'image/png', fileData: new Blob() });
	assert.equal(await f.actions.dropAsset('image'), true);
	assert.equal(f.state.timelineScenes.value[0].layers.length, 1);
	assert.equal(f.visualModule.nodes[2].effectId, 'image');
	assert.equal(f.events.includes('progress'), false);
	assert.ok(f.events.find(event => Array.isArray(event) && event[0] === 'commit')[2].some(change => change.type === 'visualModule' && change.target.inlineVisualModuleLayerId === 'inline'));
	f.history.undo();
	assert.deepEqual(f.visualModule.nodes.map(node => node.id), ['in', 'old', 'out']);
});

// 【読み込み中に対象が置き換わった場合、新しいVisual Moduleに古いドロップを適用しない】
// 素材の取り込み自体は残してAssetsを開き、開始時と同じIDでも別の定義にはノードを追加しない。
test('retains imported assets without adding nodes after the target is replaced', async t => {
	const f = fixture(t);
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const read = f.api.openMediaFile;
	f.api.openMediaFile = async options => { await gate; return read(options); };
	const dropped = f.actions.dropFiles([new File([], 'photo.png', { type: 'image/png' })]);
	f.state.visualModules.value = [{ ...f.visualModule, nodes: [] }];
	release();
	assert.equal(await dropped, false);
	assert.equal(f.state.assets.value.length, 1);
	assert.equal(f.state.visualModules.value[0].nodes.length, 0);
	assert.ok(f.events.includes('revealAssets'));
});

// 【ノード参照の検証が失敗した取り込みでは、AssetやPlayerだけを追加しない】
// バッチの後半が無効でも、部分追加を残さず、Undo履歴を増やさない。
test('validates all node references before importing any resources', t => {
	const f = fixture(t);
	const image = { id: 'image', name: 'Image', fileDataType: 'image/png', fileData: new Blob() };
	const video = { id: 'video', name: 'Video', fileDataType: 'video/mp4', fileData: new Blob() };
	const first = f.createVisualModuleAssetNode(image, []);
	const second = f.createVisualModuleAssetNode(video, []);
	assert.throws(() => f.history.commit('importAssets', { assets: [image, video], players: [], visualModule: { target: f.target, nodes: [first.node, second.node] } }), /player asset not found/);
	assert.equal(f.state.assets.value.length, 0);
	assert.equal(f.state.players.value.length, 0);
	assert.deepEqual(f.visualModule.nodes.map(node => node.id), ['in', 'old', 'out']);
	assert.equal(f.history.undoStack.value.length, 0);
});
