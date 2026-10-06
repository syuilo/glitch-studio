import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: `
		export * from './src/utility/timeline-clip-clipboard.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { createShapeTimelineLayer } from './src/utility/shape-timeline-layer.ts';
		export { genId } from '@gs/shared/utility/id.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'clip-clipboard-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			contents: path === 'effects' ? 'export const effectDefinitions = {};'
				: 'export const preferences = { s: { forceTypeSafety: true } };', loader: 'ts',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { copyTimelineClips, prepareTimelineClipPaste, canPasteTimelineClips, COMMAND_DEFS, UndoRedo, createShapeTimelineLayer, genId } = module.exports;

// ショートカットと非同期ペーストはSFCの本物を使い、DOM・メディア読み込みだけを差し込む。
// 現在の選択種別や読み込み中の編集によって貼り付けの挙動が変わるため、純粋関数のテストだけでは不足する。
const source = await readFile(new URL('../src/components/GsTimeline.vue', import.meta.url), 'utf8');
const script = parse(source).descriptor.scriptSetup.content;
const ast = createSourceFile('GsTimeline.ts', script, ScriptTarget.Latest);
const handlers = ['onTlKeydown', 'pasteClips'].map(name => {
	const declaration = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === name);
	assert.ok(declaration);
	return declaration.getText(ast);
});
const transformed = await transform(handlers.join('\n'), { loader: 'ts' });
const createHandlers = new Function('context', `
	const { HTMLElement, selection, editedScene, timelineClipboard, selectedLayer, props, stateManager, sceneLayers,
		readLayerMediaDurations, selectLayer, ui, tlEl, time, inspectTimelineClipMedia, onCueKeyboardDown, removeSelectedClips,
		copyTimelineClips, prepareTimelineClipPaste, canPasteTimelineClips, genId } = context;
	const deepClone = structuredClone;
	let disposed = false;
	${transformed.code}
	return { onTlKeydown, pasteClips, dispose: () => { disposed = true; } };
`);

function fixture(t) {
	t.mock.method(console, 'log', () => {});
	const layer = createShapeTimelineLayer('rectangle', 100);
	layer.id = 'shape';
	layer.clips = [
		{ id: 'a', startMs: 100, durationMs: 100, contentOffsetMs: 10.25 },
		{ id: 'b', startMs: 400, durationMs: 200, contentOffsetMs: 30.75 },
	];
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] };
	const state = { timelineScenes: { value: [scene] }, visualModules: { value: [] }, assets: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	const selection = { value: { kind: 'clips', clips: layer.clips.map(clip => ({ layerId: layer.id, clipId: clip.id })) } };
	const time = { value: 1000.4 };
	const timelineClipboard = { value: null };
	const alerts = [];
	const context = {
		HTMLElement: class {}, selection, editedScene: scene, timelineClipboard, selectedLayer: { value: layer },
		props: { sceneId: scene.id }, stateManager: history, sceneLayers: { get value() { return scene.layers; } },
		readLayerMediaDurations: async () => undefined,
		selectLayer: layer => { selection.value = { kind: 'layers', ids: [layer.id] }; },
		ui: { alert: alert => { alerts.push(alert); } }, tlEl: { value: { focus() {} } }, time,
		inspectTimelineClipMedia: async () => ({ durationMs: 10000 }), onCueKeyboardDown() {}, removeSelectedClips() {},
		copyTimelineClips, prepareTimelineClipPaste, canPasteTimelineClips, genId,
	};
	return { scene, layer, state, history, changes, selection, time, timelineClipboard, alerts, context,
		get clipboard() { return copyTimelineClips(scene, selection.value.clips); },
	};
}

function keyboard(key, overrides = {}) {
	return { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false,
		defaultPrevented: false, target: null, stopped: false,
		preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides,
	};
}

// 【コピー時のスナップショットをシーク位置に配置し、間隔・トリムと新規IDを維持する】
// コピー後の移動や削除に影響されず、同じ内容を複数回貼り付けてもIDが衝突しないようにする。
test('snapshots clips and places their earliest start at the rounded seek time', t => {
	const f = fixture(t);
	const clipboard = f.clipboard;
	f.layer.clips[0].contentOffsetMs = 99;
	f.layer.clips = [];
	const first = prepareTimelineClipPaste(f.scene, clipboard, 1000.4);
	const second = prepareTimelineClipPaste(f.scene, clipboard, 2000);
	assert.deepEqual(first.map(({ layerId, clip }) => [layerId, clip.startMs, clip.durationMs, clip.contentOffsetMs]),
		[['shape', 1000, 100, 10.25], ['shape', 1300, 200, 30.75]]);
	assert.equal(new Set([...first, ...second, ...clipboard.clips].map(entry => entry.clip.id)).size, 6);
	assert.deepEqual(clipboard.clips.map(entry => entry.clip.startMs), [100, 400]);
});

// 【重なる貼り付けを全体で拒否し、境界の接触と選択内の空白は許可する】
// 空き区間に合わせて長さを縮めたり、空白にある既存クリップを押し出したりしない仕様。
test('rejects any overlap but permits touching boundaries and occupied gaps between copied clips', t => {
	const f = fixture(t);
	const clipboard = f.clipboard;
	for (const time of [100, 50, 199, 350, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
		assert.equal(prepareTimelineClipPaste(f.scene, clipboard, time), null, `time=${time}`);
	}
	assert.ok(prepareTimelineClipPaste(f.scene, clipboard, 600));
	f.layer.clips = [{ id: 'gap', startMs: 1100, durationMs: 200, contentOffsetMs: 0 }];
	assert.ok(prepareTimelineClipPaste(f.scene, clipboard, 1000));
	f.layer.clips[0].durationMs = 201;
	assert.equal(prepareTimelineClipPaste(f.scene, clipboard, 1000), null);
});

// 【別Sceneや削除済みのコピー元レイヤーへ貼り付けない】
// IDが同じでも新規読み込みしたSceneはコピー元とは別で、選択中の別レイヤーへ振り替えない。
test('requires the original scene and every original layer', t => {
	const f = fixture(t);
	const clipboard = f.clipboard;
	assert.equal(prepareTimelineClipPaste(structuredClone(f.scene), clipboard, 1000), null);
	f.scene.layers = [{ ...f.layer, id: 'other' }];
	assert.equal(prepareTimelineClipPaste(f.scene, clipboard, 1000), null);
	assert.equal(copyTimelineClips(f.scene, []), null);
	assert.equal(copyTimelineClips(f.scene, [{ layerId: 'other', clipId: 'missing' }]), null);
});

// 【複数レイヤーの貼り付けを1回のUndoで戻し、Redoで同じIDと同期通知を復元する】
// クリップだけを追加し、レイヤーの形状・合成設定・キーはコピーも移動も行わない。
test('pastes into source layers atomically with one undo entry and clip change notifications', t => {
	const f = fixture(t);
	const other = { ...structuredClone(f.layer), id: 'other', clips: [{ id: 'a', startMs: 200, durationMs: 50, contentOffsetMs: 0 }] };
	f.scene.layers.push(other);
	f.selection.value.clips.push({ layerId: 'other', clipId: 'a' });
	const before = structuredClone(f.scene);
	const clips = prepareTimelineClipPaste(f.scene, f.clipboard, 1000);
	f.history.commit('pasteTimelineClips', { sceneId: f.scene.id, clips });
	const after = structuredClone(f.scene);
	assert.deepEqual(clips.map(entry => entry.clip.startMs), [1000, 1300, 1100]);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual(f.scene, before);
	f.history.redo();
	assert.deepEqual(f.scene, after);
	for (const changes of f.changes) assert.deepEqual(changes,
		['shape', 'other'].map(layerId => ({ type: 'layer', sceneId: 'scene', layerId, changes: [{ type: 'clips' }] })));
});

// 【コマンド境界でも衝突・不正素材を拒否し、検証済みの別レイヤーだけ変更しない】
// UIで空きを確認した後の編集にも対応し、失敗時はUndo履歴・Redo履歴・同期通知を維持する。
test('rejects conflicting or invalid batches before mutating any layer or history', t => {
	const f = fixture(t);
	const clips = prepareTimelineClipPaste(f.scene, f.clipboard, 1000);
	f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips });
	f.history.undo();
	f.changes.length = 0;
	f.scene.layers.push({ ...structuredClone(f.layer), id: 'other', clips: [] });
	const invalid = { layerId: 'other', clip: { ...clips[0].clip, id: 'invalid', durationMs: 0 } };
	const before = structuredClone(f.scene);
	assert.throws(() => f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips: [...clips, invalid] }), /Invalid clip timing/);
	assert.deepEqual(f.scene, before);
	f.layer.clips.push({ id: 'blocking', startMs: 1300, durationMs: 1, contentOffsetMs: 0 });
	assert.equal(canPasteTimelineClips(f.scene, clips), false);
	assert.throws(() => f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips }), /Overlapping clips/);
	assert.equal(f.history.undoStack.value.length, 0);
	assert.equal(f.history.redoStack.value.length, 1);
	assert.equal(f.changes.length, 0);
});

// 【動画の素材・小数オフセット・音声有効設定をコピーし、素材長を超える貼り付けは拒否する】
// レイヤーにある他の参照切れ素材は今回の貼り付けを妨げず、コピーした素材だけを検証する。
test('preserves video settings and validates only pasted media against its current duration', t => {
	const f = fixture(t);
	f.layer.layerType = 'video';
	f.layer.clips = [{ id: 'video', startMs: 100, durationMs: 100, contentOffsetMs: 20.25, assetId: 'movie', audioEnabled: false }];
	f.state.assets.value = [{ id: 'movie', fileDataType: 'video/mp4' }];
	f.selection.value.clips = [{ layerId: 'shape', clipId: 'video' }];
	const clips = prepareTimelineClipPaste(f.scene, f.clipboard, 1000);
	assert.equal(clips[0].clip.audioEnabled, false);
	const sourceDurationsMs = { [clips[0].clip.id]: 120.25 };
	assert.throws(() => f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips }), /Invalid media duration/);
	assert.throws(() => f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips, sourceDurationsMs: { [clips[0].clip.id]: 119 } }), /Clip exceeds/);
	f.layer.clips.push({ id: 'missing', startMs: 300, durationMs: 100, contentOffsetMs: 0, assetId: 'missing', audioEnabled: true });
	f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips, sourceDurationsMs });
	assert.deepEqual(f.layer.clips.at(-1), clips[0].clip);
});

// 【Ctrl/Cmd+C・Vでクリップをコピーし、選択が変わってもコピー元へ貼り付ける】
// ペースト先は選択レイヤーではなくコピー元で、成功後は追加したクリップを選択する。
// 押し続けによる繰り返しや入力欄の編集はタイムライン操作として処理しない。
test('routes copy and paste shortcuts by clipboard content and selects pasted clips', async t => {
	for (const modifiers of [{ ctrlKey: true }, { ctrlKey: false, metaKey: true }]) {
		const f = fixture(t);
		const handlers = createHandlers(f.context);
		const copy = keyboard('c', modifiers);
		await handlers.onTlKeydown(copy);
		assert.ok(copy.defaultPrevented && copy.stopped);
		f.selection.value = { kind: 'layers', ids: ['other'] };
		await handlers.onTlKeydown(keyboard('v', { ...modifiers, repeat: true }));
		assert.equal(f.history.undoStack.value.length, 0);
		await handlers.onTlKeydown(keyboard('v', modifiers));
		assert.equal(f.history.undoStack.value.length, 1);
		assert.deepEqual(f.selection.value, { kind: 'clips', clips: f.layer.clips.slice(2).map(clip => ({ layerId: 'shape', clipId: clip.id })) });
		await handlers.onTlKeydown(keyboard('v', modifiers));
		assert.equal(f.history.undoStack.value.length, 1);
		const input = new f.context.HTMLElement();
		input.closest = () => true;
		const typing = keyboard('c', { target: input });
		await handlers.onTlKeydown(typing);
		assert.equal(typing.defaultPrevented, false);
	}
});

// 【クリップコピー後でもレイヤーコピーで内容を置き換え、従来のレイヤーペーストを維持する】
// クリップ用とレイヤー用の古いコピー内容が併存すると、選択変更で意図しないものが貼り付けられる。
test('replaces clip clipboard contents when copying a layer and preserves layer paste behavior', async t => {
	const f = fixture(t);
	const handlers = createHandlers(f.context);
	await handlers.onTlKeydown(keyboard('c'));
	assert.equal(f.timelineClipboard.value.kind, 'clips');
	f.selection.value = { kind: 'layers', ids: [f.layer.id] };
	await handlers.onTlKeydown(keyboard('c'));
	assert.equal(f.timelineClipboard.value.kind, 'layer');
	const before = structuredClone(f.scene);
	await handlers.onTlKeydown(keyboard('v'));
	assert.equal(f.scene.layers.length, 2);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.notEqual(f.scene.layers[0].id, f.layer.id);
	assert.deepEqual(f.scene.layers[0].clips.map(clip => clip.startMs), [100, 400]);
	f.history.undo();
	assert.deepEqual(f.scene, before);
});

// 【素材情報の読み込み中に再生が進んでも操作時のシーク位置を使い、衝突が生じたら中止する】
// 非同期準備の完了時にも空きを再確認し、別プロジェクトへの読み込み・パネル破棄後は変更しない。
test('keeps the requested seek time and rechecks state after asynchronous media loading', async t => {
	for (const change of ['seek', 'overlap', 'reload', 'dispose', 'asset']) {
		const f = fixture(t);
		f.layer.layerType = 'audio';
		f.layer.clips = [{ id: 'audio', startMs: 100, durationMs: 100, contentOffsetMs: 10.25, assetId: 'sound' }];
		const asset = { id: 'sound', fileDataType: 'audio/wav', fileData: new Blob() };
		f.state.assets.value = [asset];
		f.selection.value.clips = [{ layerId: 'shape', clipId: 'audio' }];
		let finish;
		f.context.inspectTimelineClipMedia = () => new Promise(resolve => { finish = resolve; });
		const handlers = createHandlers(f.context);
		const pending = handlers.pasteClips(f.clipboard);
		f.time.value = 2000;
		if (change === 'overlap') f.layer.clips.push({ ...f.layer.clips[0], id: 'blocking', startMs: 1000 });
		if (change === 'reload') f.state.timelineScenes.value = [structuredClone(f.scene)];
		if (change === 'dispose') handlers.dispose();
		if (change === 'asset') asset.fileData = new Blob();
		finish({ durationMs: 10000 });
		await pending;
		assert.equal(f.history.undoStack.value.length, change === 'seek' ? 1 : 0, change);
		if (change === 'seek') assert.equal(f.layer.clips.at(-1).startMs, 1000);
		assert.deepEqual(f.alerts, []);
	}
});
