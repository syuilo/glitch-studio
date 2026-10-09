import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { resolveDir: uiDirectory, loader: 'ts', contents: `
		export { createTimelineSourceActions } from './src/utility/timeline-source-actions.ts';
		export { createTimelineClipboardActions } from './src/utility/timeline-clipboard-actions.ts';
		export { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'source-actions-dependencies', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: path === 'effects'
			? 'export const effectDefinitions = {};'
			: 'export const preferences = { s: { forceTypeSafety: true } };',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createTimelineSourceActions, createTimelineClipboardActions, flattenTimelineLayers, COMMAND_DEFS, UndoRedo } = module.exports;

function deferred() {
	let resolve;
	const promise = new Promise(finish => { resolve = finish; });
	return { promise, resolve };
}

function mediaLayer(layerType = 'audio', id = 'layer') {
	return { id, name: id, layerType, isDisabled: false, automationGraphs: [], clips: [], audioParamValues: {}, compositingParamValues: {} };
}

function fixture(t, layers = [mediaLayer()]) {
	t.mock.method(console, 'log', () => {});
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers };
	const asset = { id: 'asset', name: 'Media', fileDataType: 'audio/wav', fileData: new Blob() };
	const state = { timelineScenes: { value: [scene] }, assets: { value: [asset] }, visualModules: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const time = { value: 1000 };
	const selection = { value: { kind: 'layers', ids: [] } };
	const errors = [];
	let active = true;
	let menu;
	let chosenEffect;
	// computedと同じく、ツリーを変更しない限り同じ配列を返し、非同期処理の同一性確認を実際に通す。
	const sceneLayers = { value: flattenTimelineLayers(scene.layers) };
	const options = {
		stateManager: history, scene, sceneLayers, currentTime: time,
		isActive: () => active && state.timelineScenes.value.find(entry => entry.id === scene.id) === scene,
		inspectMedia: async () => ({ durationMs: 10000, audioAvailable: true, audioError: null }),
		ui: {
			select: async () => ({ canceled: false, result: asset.id }),
			confirm: async () => ({ canceled: false }),
			popupMenu: items => { menu = items; },
			alert: error => { errors.push(error); },
		},
		pickEffect: callback => { chosenEffect = callback; }, desktopAvailable: () => true,
		selectLayer: layer => { selection.value = { kind: 'layers', ids: [layer.id] }; },
		selectClip: target => { selection.value = { kind: 'clips', clips: [target] }; },
		addEmptyGroup() {}, seek: value => { time.value = value; }, reportError: error => { errors.push(error); },
	};
	return { scene, asset, state, history, time, selection, errors, options,
		create: () => createTimelineSourceActions(options),
		refreshLayers: () => { sceneLayers.value = flattenTimelineLayers(scene.layers); },
		dispose: () => { active = false; },
		get menu() { return menu; }, get chosenEffect() { return chosenEffect; },
	};
}

function addLayerMenu(actions) { actions.showAddLayerMenu({ currentTarget: null, target: null }); }

// 【素材選択を待つ間のクリップ追加を反映し、追加したクリップを一回のUndoで戻す】
// 操作時点の空きを使い続けると後から追加されたクリップと重なるため、commit直前に長さを再計算する。
test('rechecks available space after selection and adds a clip with one undo entry', async t => {
	const f = fixture(t);
	const choice = deferred();
	f.options.ui.select = () => choice.promise;
	const pending = f.create().addClip(f.scene.layers[0], 1000.4);
	f.scene.layers[0].clips.push({ id: 'blocking', assetId: f.asset.id, startMs: 1500, durationMs: 100, contentOffsetMs: 0 });
	const before = structuredClone(f.scene);
	choice.resolve({ canceled: false, result: f.asset.id });
	await pending;
	const clip = f.scene.layers[0].clips.find(clip => clip.id !== 'blocking');
	assert.deepEqual([clip.startMs, clip.durationMs, clip.assetId], [1000, 500, 'asset']);
	assert.deepEqual(f.selection.value, { kind: 'clips', clips: [{ layerId: 'layer', clipId: clip.id }] });
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual(f.scene, before);
	assert.deepEqual(f.errors, []);
});

// 【選択・素材読み込み・警告確認中の破棄や素材差し替えを採用しない】
// ダイアログが返るまでに別プロジェクトや別Blobへ切り替わった場合、古い素材情報で履歴を作らない。
test('rejects stale selections and metadata after scene, asset or lifetime changes', async t => {
	for (const phase of ['select', 'inspect', 'confirm']) {
		for (const change of ['reload', 'dispose', 'layers', 'assets', 'blob']) {
			const f = fixture(t, [mediaLayer('video')]);
			f.asset.fileDataType = 'video/mp4';
			const wait = deferred();
			const started = deferred();
			const result = phase === 'select' ? { canceled: false, result: f.asset.id }
				: phase === 'inspect' ? { durationMs: 10000, audioAvailable: true, audioError: null } : { canceled: false };
			if (phase === 'select') f.options.ui.select = () => { started.resolve(); return wait.promise; };
			if (phase === 'inspect') f.options.inspectMedia = () => { started.resolve(); return wait.promise; };
			if (phase === 'confirm') {
				f.options.inspectMedia = async () => ({ durationMs: 10000, audioAvailable: false, audioError: 'Unsupported audio' });
				f.options.ui.confirm = () => { started.resolve(); return wait.promise; };
			}
			const pending = f.create().addClip(f.scene.layers[0], 1000);
			await started.promise;
			if (change === 'reload') f.state.timelineScenes.value = [structuredClone(f.scene)];
			if (change === 'dispose') f.dispose();
			if (change === 'layers') { f.scene.layers = []; f.refreshLayers(); }
			if (change === 'assets') f.state.assets.value = [];
			if (change === 'blob') f.asset.fileData = new Blob();
			wait.resolve(result);
			await pending;
			// 選択後にBlobを取得するので、選択中の差し替えは新しいBlobを読み込んで追加する。
			assert.equal(f.history.undoStack.value.length, phase === 'select' && change === 'blob' ? 1 : 0, `${phase}/${change}`);
			assert.deepEqual(f.errors, []);
		}
	}
});

// 【音声なし動画の警告を確認してから、音声を無効にしたレイヤーを追加する】
// 音声のデコード失敗を黙って扱わず、取消しでは履歴や選択を変更しない。追加時刻と素材長も維持する。
test('adds video layers without audio only after confirmation and honors cancellation', async t => {
	for (const canceled of [false, true]) {
		const f = fixture(t, []);
		f.asset.fileDataType = 'video/mp4';
		f.options.inspectMedia = async () => ({ durationMs: 3000, audioAvailable: false, audioError: 'Unsupported audio' });
		f.options.ui.confirm = async warning => {
			assert.equal(warning.okText, 'Add without audio');
			return { canceled };
		};
		addLayerMenu(f.create());
		await f.menu.find(item => item.text === 'Video').action();
		assert.equal(f.history.undoStack.value.length, canceled ? 0 : 1);
		if (!canceled) {
			const layer = f.scene.layers[0];
			assert.equal(layer.layerType, 'video');
			assert.deepEqual([layer.clips[0].startMs, layer.clips[0].durationMs, layer.clips[0].audioEnabled], [1000, 3000, false]);
			assert.equal(f.selection.value.clips[0].layerId, layer.id);
			f.history.undo();
			assert.deepEqual(f.scene.layers, []);
		}
	}
});

// 【素材差し替えはピッカーを開いたクリップにだけ適用し、対象の削除・置換後は中止する】
// 同じIDの別クリップを編集せず、成功時には従来どおりoffsetをリセットしてUndoで復元する。
test('changes only the original clip source and restores its timing on undo', async t => {
	for (const change of ['none', 'remove', 'replace']) {
		const f = fixture(t);
		const layer = f.scene.layers[0];
		const clip = { id: 'clip', assetId: 'old', startMs: 1000, durationMs: 500, contentOffsetMs: 50 };
		layer.clips = [clip];
		const before = structuredClone(f.scene);
		const choice = deferred();
		f.options.ui.select = () => choice.promise;
		const pending = f.create().changeClipSource({ layerId: layer.id, clipId: clip.id });
		if (change === 'remove') layer.clips = [];
		if (change === 'replace') layer.clips = [{ ...clip }];
		choice.resolve({ canceled: false, result: f.asset.id });
		await pending;
		assert.equal(f.history.undoStack.value.length, change === 'none' ? 1 : 0);
		if (change === 'none') {
			assert.equal(clip.assetId, f.asset.id);
			assert.equal(clip.contentOffsetMs, 0);
			f.history.undo();
			assert.deepEqual(f.scene, before);
		}
	}
});

// 【Visual Moduleの参照レイヤーを追加し、選択待ち中のScene切替では中止する】
// 切り出し後も対象SceneのIDとVisual ModuleのIDを取り違えず、選択結果から参照レイヤーを作る。
test('adds referenced visual module layers and rejects results after scene replacement', async t => {
	for (const reload of [false, true]) {
		const f = fixture(t, []);
		f.state.visualModules.value = [{ id: 'visual-module', name: 'Visual Module', paramDefs: [] }];
		const choice = deferred();
		f.options.ui.select = () => choice.promise;
		addLayerMenu(f.create());
		const pending = f.menu.find(item => item.text === 'Visual Module (Reference)').action();
		if (reload) f.state.timelineScenes.value = [structuredClone(f.scene)];
		choice.resolve({ canceled: false, result: 'visual-module' });
		await pending;
		assert.equal(f.history.undoStack.value.length, reload ? 0 : 1);
		if (!reload) {
			assert.equal(f.scene.layers[0].visualModuleId, 'visual-module');
			assert.deepEqual(f.selection.value.ids, [f.scene.layers[0].id]);
		}
	}
});

// 【グループ内で同じクリップIDを持つ素材の長さをレイヤーごとに読み、貼り付けを一回のUndoで扱う】
// 素材読み込みの切り出しでレイヤーIDの索引を失うと、短い素材の長さを別レイヤーへ誤用してしまう。
test('loads grouped media durations by layer and pastes the group through clipboard actions', async t => {
	const short = mediaLayer('audio', 'short');
	const long = mediaLayer('audio', 'long');
	short.clips = [{ id: 'clip', assetId: 'short-asset', startMs: 0, durationMs: 100, contentOffsetMs: 0 }];
	long.clips = [{ id: 'clip', assetId: 'long-asset', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }];
	const group = { id: 'group', name: 'Group', layerType: 'group', layers: [short, long], isDisabled: false, automationGraphs: [], audioParamValues: {}, compositingParamValues: {} };
	const f = fixture(t, [group]);
	f.state.assets.value = [short, long].map(layer => ({ ...f.asset, id: layer.clips[0].assetId, fileData: new Blob() }));
	f.options.inspectMedia = async asset => ({ durationMs: asset.id === 'short-asset' ? 100 : 1000 });
	const sources = f.create();
	const durations = await sources.readLayerMediaDurations(group);
	assert.deepEqual({ ...durations }, { short: { clip: 100 }, long: { clip: 1000 } });
	const clipboard = { value: { kind: 'layer', layer: structuredClone(group) } };
	const actions = createTimelineClipboardActions({
		...f.options, clipboard, selection: f.selection, selectedLayer: { value: group },
		readLayerMediaDurations: sources.readLayerMediaDurations, focusTimeline() {},
	});
	const before = structuredClone(f.scene);
	await actions.paste();
	assert.equal(f.history.undoStack.value.length, 1);
	assert.deepEqual(f.scene.layers[0].layers.map(layer => layer.clips[0].durationMs), [100, 1000]);
	f.history.undo();
	assert.deepEqual(f.scene, before);
	assert.deepEqual(f.errors, []);
});
