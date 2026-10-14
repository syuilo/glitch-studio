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
			selectAsset: async () => [structuredClone(asset)],
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

// 【固定動画で同じ素材を選び直すと通常再生へ戻り、Undoで固定地点を復元する】
// 通常の素材変更では同一Assetを選ぶ操作を省略するが、固定表示では時間モデルを戻す
// 操作として必要になる。素材の追加や画像生成を要求せず、元の動画の再生に戻せるようにする。
test('returns held video to playback when selecting the same asset again', async t => {
	const layer = mediaLayer('video');
	const f = fixture(t, [layer]);
	f.asset.fileDataType = 'video/mp4';
	const held = { id: 'clip', assetId: f.asset.id, startMs: 1000, durationMs: 15000, sourceTimeMs: 2500.25, audioEnabled: false };
	layer.clips = [{ ...held }];
	await f.create().changeClipSource({ layerId: layer.id, clipId: 'clip' });
	assert.deepEqual(layer.clips[0], { id: 'clip', assetId: f.asset.id, startMs: 1000, durationMs: 10000,
		sourceInMs: 0, sourceOutMs: 10000, playbackRate: 1, loop: false, audioEnabled: false });
	f.history.undo();
	assert.deepEqual(layer.clips[0], held);
	assert.deepEqual(f.errors, []);
});

// 【動画・音声レイヤーの初期クリップを素材の長さに合わせる】
// 5秒を超える素材が途中で切れないことと、短い素材や小数msの素材でも
// 素材端を越えず配置されることを、追加メニューとCommandを通して確認する。
test('adds video and audio layers with the source duration and restores them on redo', async t => {
	for (const layerType of ['video', 'audio']) {
		for (const sourceDurationMs of [12500, 3000, 12500.75]) {
			const f = fixture(t, []);
			f.asset.fileDataType = layerType === 'video' ? 'video/mp4' : 'audio/wav';
			f.options.inspectMedia = async () => ({ durationMs: sourceDurationMs, audioAvailable: true, audioError: null });
			addLayerMenu(f.create());
			await f.menu.find(item => item.text === (layerType === 'video' ? 'Video' : 'Audio')).action();
			const layer = f.scene.layers[0];
			assert.equal(layer.layerType, layerType);
			assert.deepEqual(layer.clips[0], {
				id: layer.clips[0].id, assetId: f.asset.id, startMs: 1000, durationMs: Math.floor(sourceDurationMs),
				sourceInMs: 0, sourceOutMs: Math.floor(sourceDurationMs), playbackRate: 1, loop: false,
				...(layerType === 'video' ? { audioEnabled: true } : {}),
			});
			const added = structuredClone(f.scene);
			f.history.undo();
			assert.deepEqual(f.scene.layers, []);
			f.history.redo();
			assert.deepEqual(f.scene, added);
			assert.deepEqual(f.errors, []);
		}
	}
});

// 【既存の動画・音声レイヤーへの追加も素材長を使い、隣のクリップを越えない】
// レイヤー追加だけを修正すると後から追加したクリップは5秒で切れてしまう。
// 5秒より広い空きでも、素材全体か次のクリップまでの区間を使うことを保証する。
test('adds media clips with the source duration limited by the next clip', async t => {
	for (const layerType of ['video', 'audio']) {
		for (const nextStartMs of [null, 9000]) {
			const f = fixture(t, [mediaLayer(layerType)]);
			f.asset.fileDataType = layerType === 'video' ? 'video/mp4' : 'audio/wav';
			const layer = f.scene.layers[0];
			if (nextStartMs != null) layer.clips.push({ id: 'next', assetId: f.asset.id,
				startMs: nextStartMs, durationMs: 1000, sourceInMs: 0, sourceOutMs: 1000,
				playbackRate: 1, loop: false, ...(layerType === 'video' ? { audioEnabled: true } : {}),
			});
			const before = structuredClone(f.scene);
			await f.create().addClip(layer, 1000);
			const clip = layer.clips.find(clip => clip.id !== 'next');
			const expectedDurationMs = nextStartMs == null ? 10000 : nextStartMs - 1000;
			assert.deepEqual([clip.startMs, clip.durationMs, clip.sourceInMs, clip.sourceOutMs], [1000, expectedDurationMs, 0, expectedDurationMs]);
			f.history.undo();
			assert.deepEqual(f.scene, before);
			assert.deepEqual(f.errors, []);
		}
	}
});

// 【追加メニューからカメラを作り、再生位置に有効クリップを配置する】
// 型や評価器だけ追加してもUIから作れなければ編集できない。通常の追加Commandと選択への接続を確認する。
test('adds camera layers at the playhead through the layer menu', t => {
	const f = fixture(t, []);
	const actions = f.create();
	addLayerMenu(actions);
	f.menu.find(item => item.text === 'Camera').action();
	const camera = f.scene.layers[0];
	assert.equal(camera.layerType, 'camera');
	assert.equal(camera.clips[0].startMs, 1000);
	assert.deepEqual(f.selection.value, { kind: 'layers', ids: [camera.id] });
	assert.equal('compositingParamValues' in camera, false);
	assert.equal('coordinateSpace' in camera, false);
	f.history.undo();
	assert.equal(f.scene.layers.length, 0);
	f.history.redo();
	assert.equal(f.scene.layers[0].id, camera.id);
});

// 【素材選択を待つ間のクリップ追加を反映し、追加したクリップを一回のUndoで戻す】
// 操作時点の空きを使い続けると後から追加されたクリップと重なるため、commit直前に長さを再計算する。
test('rechecks available space after selection and adds a clip with one undo entry', async t => {
	const f = fixture(t);
	const choice = deferred();
	f.options.ui.selectAsset = () => choice.promise;
	const pending = f.create().addClip(f.scene.layers[0], 1000.4);
	f.scene.layers[0].clips.push({ id: 'blocking', assetId: f.asset.id, startMs: 1500, durationMs: 100, sourceInMs: 0, sourceOutMs: 100, playbackRate: 1, loop: false });
	const before = structuredClone(f.scene);
	choice.resolve([structuredClone(f.asset)]);
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
			const result = phase === 'select' ? [structuredClone(f.asset)]
				: phase === 'inspect' ? { durationMs: 10000, audioAvailable: true, audioError: null } : { canceled: false };
			if (phase === 'select') f.options.ui.selectAsset = () => { started.resolve(); return wait.promise; };
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
		const clip = { id: 'clip', assetId: 'old', startMs: 1000, durationMs: 500, sourceInMs: 50, sourceOutMs: 550, playbackRate: 1, loop: false };
		layer.clips = [clip];
		const before = structuredClone(f.scene);
		const choice = deferred();
		f.options.ui.selectAsset = () => choice.promise;
		const pending = f.create().changeClipSource({ layerId: layer.id, clipId: clip.id });
		if (change === 'remove') layer.clips = [];
		if (change === 'replace') layer.clips = [{ ...clip }];
		choice.resolve([structuredClone(f.asset)]);
		await pending;
		assert.equal(f.history.undoStack.value.length, change === 'none' ? 1 : 0);
		if (change === 'none') {
			assert.equal(clip.assetId, f.asset.id);
			assert.equal(clip.sourceInMs, 0);
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
			assert.equal(f.scene.layers[0].coordinateSpace, 'screen');
			assert.deepEqual(f.selection.value.ids, [f.scene.layers[0].id]);
		}
	}
});

// 【グループ内で同じクリップIDを持つ素材の長さをレイヤーごとに読み、貼り付けを一回のUndoで扱う】
// 素材読み込みの切り出しでレイヤーIDの索引を失うと、短い素材の長さを別レイヤーへ誤用してしまう。
test('loads grouped media durations by layer and pastes the group through clipboard actions', async t => {
	const short = mediaLayer('audio', 'short');
	const long = mediaLayer('audio', 'long');
	short.clips = [{ id: 'clip', assetId: 'short-asset', startMs: 0, durationMs: 100, sourceInMs: 0, sourceOutMs: 100, playbackRate: 1, loop: false }];
	long.clips = [{ id: 'clip', assetId: 'long-asset', startMs: 0, durationMs: 1000, sourceInMs: 0, sourceOutMs: 1000, playbackRate: 1, loop: false }];
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
