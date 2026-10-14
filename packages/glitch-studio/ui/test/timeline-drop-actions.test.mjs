import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ref } from 'vue';

const bundle = await build({
	stdin: { contents: `export { createTimelineDropActions } from './utility/timeline-drop-actions.ts';
		export { createTimelineAssetLayer } from './utility/timeline-asset-layer.ts';
		export { COMMAND_DEFS } from './commands.ts'; export { UndoRedo } from './utility/undo-redo.ts';`,
		resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'timeline-drop-dependencies', setup(build) {
		build.onResolve({ filter: /\/api\.ts$/ }, () => ({ path: 'test-api', external: true }));
		build.onResolve({ filter: /ui\.ts$/ }, () => ({ path: 'test-ui', external: true }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'test-preferences', external: true }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'test-effects', external: true }));
	} }],
});

function fixture(t) {
	t.mock.method(console, 'log', () => {});
	const events = [];
	let dialogs = 0;
	const mocks = {
		'test-effects': { effectDefinitions: {} }, 'test-preferences': { preferences: { s: { forceTypeSafety: true } } },
		'test-ui': {
			progress() {
				dialogs++;
				events.push('progress');
				return { setProgress: value => events.push(['progress', value]), setSubProgress: value => events.push(['subProgress', value]),
					setText: value => events.push(['text', value]), done: () => { dialogs--; events.push('done'); } };
			},
			alert: async options => { assert.equal(dialogs, 0); events.push(['alert', options.text]); },
		},
		'test-api': {
			selectMediaFiles: async options => options.files,
			openMediaFile: async options => {
				assert.equal(dialogs, 1, 'Import progress must open before reading');
				assert.equal(options.allowAnyFile, true);
				return options.files.map(file => ({ name: file.name, type: file.type, fileData: file,
					width: 100, height: 100, hash: file.name, thumbnailSequence: null, sourceFilePath: null }));
			},
		},
	};
	const module = { exports: {} };
	const require = createRequire(import.meta.url);
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(name => mocks[name] ?? require(name), module, module.exports);
	const { createTimelineDropActions, createTimelineAssetLayer, UndoRedo, COMMAND_DEFS } = module.exports;
	const state = { timelineScenes: ref([{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] }]),
		assets: ref([]), players: ref([]), visualModules: ref([]) };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => { changes.push(value); events.push(['commit', dialogs]); });
	const time = ref(1234);
	const media = new Map();
	let active = true;
	const options = { context: { stateManager: history }, sceneId: 'scene', currentTime: () => time.value,
		isActive: () => active, revealAssets: () => events.push('revealAssets'), inspectMedia: async asset => {
			assert.equal(dialogs, 1, 'Metadata inspection must keep the same progress dialog open');
			const result = media.get(asset.name);
			if (result instanceof Error) throw result;
			return await (result ?? { durationMs: 9000.5, audioAvailable: true, audioError: null });
		} };
	return { events, history, state, changes, time, media, options, createTimelineAssetLayer,
		actions: createTimelineDropActions(options), scene: state.timelineScenes.value[0], deactivate: () => { active = false; } };
}

// 【複数ファイルを入力順に最上段へ配置し、Asset・Player・レイヤーを一度にUndoする】
// メタデータ取得中に再生ヘッドが進んでも全素材の開始を揃える。フォント・テキストは素材として残し、
// 配置対象外が含まれる場合はAssetsを開く。通知・履歴も一括で反映する。
test('imports a mixed batch at the captured playhead with one atomic undo and redo', async t => {
	const f = fixture(t);
	const files = [new File(['image'], 'photo.png', { type: 'image/png' }), new File(['video'], 'movie.mp4', { type: 'video/mp4' }),
		new File(['audio'], 'sound.wav', { type: 'audio/wav' }), new File(['font'], 'font.ttf', { type: 'font/ttf' }),
		new File(['text'], 'notes.txt', { type: 'text/plain' })];
	f.media.set('movie.mp4', Promise.resolve().then(() => {
		f.time.value = 5000; return { durationMs: 9000.5, audioAvailable: true, audioError: null };
	}));
	await f.actions.dropFiles(files);
	assert.deepEqual(f.scene.layers.map(layer => layer.name), ['photo.png', 'movie.mp4', 'sound.wav']);
	assert.deepEqual(f.scene.layers.map(layer => layer.clips[0].startMs), [1234, 1234, 1234]);
	assert.deepEqual(f.scene.layers.map(layer => layer.clips[0].durationMs), [5000, 9000, 9000]);
	assert.equal(f.scene.layers[1].clips[0].audioEnabled, true);
	assert.equal(f.state.assets.value.length, 5);
	assert.equal(f.state.players.value.length, 2);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.equal(f.changes.length, 1);
	assert.ok(f.changes[0].some(change => change.type === 'layerOrder'));
	assert.equal(f.events.filter(event => event === 'progress').length, 1);
	assert.deepEqual(f.events.find(event => Array.isArray(event) && event[0] === 'commit'), ['commit', 1]);
	assert.ok(f.events.includes('revealAssets'));
	const before = f.scene.layers.map(layer => layer.id);
	f.history.undo();
	assert.equal(f.scene.layers.length, 0);
	assert.equal(f.state.assets.value.length, 0);
	assert.equal(f.state.players.value.length, 0);
	f.history.redo();
	assert.deepEqual(f.scene.layers.map(layer => layer.id), before);
	assert.deepEqual(f.state.assets.value.map(asset => asset.name), files.map(file => file.name));
});

// 【既存Assetのドロップでは素材を複製せず、配置対象外は無視する】
// 動画・音声用Playerの重複追加や、フォントのドロップで履歴だけが増えることを防ぐ。
test('adds existing assets without importing duplicates and ignores fonts', async t => {
	const f = fixture(t);
	f.state.assets.value.push({ id: 'video', name: 'Movie', fileDataType: 'video/mp4', fileData: new Blob() },
		{ id: 'font', name: 'Font', fileDataType: 'font/ttf', fileData: new Blob() });
	await f.actions.dropAsset('font');
	await f.actions.dropAsset('missing');
	assert.deepEqual(f.events, []);
	await f.actions.dropAsset('video');
	assert.equal(f.state.assets.value.length, 2);
	assert.equal(f.state.players.value.length, 0);
	assert.equal(f.scene.layers[0].clips[0].assetId, 'video');
	assert.equal(f.history.undoStack.value.length, 1);
	assert.equal(f.events.includes('revealAssets'), false);
});

// 【配置できない素材も取り込みを維持し、他の素材の追加を妨げない】
// メタデータ取得失敗や0秒素材で全体の取り込みを失わず、映像だけ使える動画は無音で追加する。
// 警告は進捗ダイアログを閉じた後に表示する。
test('keeps failed media in assets and adds videos without decodable audio', async t => {
	const f = fixture(t);
	f.media.set('broken.mp4', new Error('Cannot decode'));
	f.media.set('empty.wav', { durationMs: 0, audioAvailable: true, audioError: null });
	f.media.set('silent.mp4', { durationMs: 1000, audioAvailable: false, audioError: 'Audio unavailable' });
	await f.actions.dropFiles([new File([], 'broken.mp4', { type: 'video/mp4' }), new File([], 'empty.wav', { type: 'audio/wav' }),
		new File([], 'silent.mp4', { type: 'video/mp4' })]);
	assert.equal(f.state.assets.value.length, 3);
	assert.deepEqual(f.scene.layers.map(layer => layer.name), ['silent.mp4']);
	assert.equal(f.scene.layers[0].clips[0].audioEnabled, false);
	assert.ok(f.events.includes('revealAssets'));
	assert.match(f.events.find(event => Array.isArray(event) && event[0] === 'alert')[1], /Cannot decode[\s\S]*usable duration[\s\S]*Audio unavailable/);
});

// 【取り込みのレイヤー検証が失敗した場合、AssetやPlayerだけを途中反映しない】
// 一括Commandの後半が失敗しても、Undo不能な中途半端な状態を残さない。
test('validates every planned layer before mutating imported resources', t => {
	const f = fixture(t);
	const asset = { id: 'image', name: 'Image', fileDataType: 'image/png', fileData: new Blob() };
	const first = f.createTimelineAssetLayer(asset, 0, null);
	const second = f.createTimelineAssetLayer({ ...asset, id: 'missing' }, 0, null);
	assert.throws(() => f.history.commit('importAssets', { assets: [asset], players: [],
		timeline: { sceneId: 'scene', layers: [first, second], sourceDurationsMs: {} } }));
	assert.equal(f.state.assets.value.length, 0);
	assert.equal(f.scene.layers.length, 0);
	assert.equal(f.history.undoStack.value.length, 0);
});
