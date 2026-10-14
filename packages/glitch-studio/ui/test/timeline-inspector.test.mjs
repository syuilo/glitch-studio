import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, markRaw, nextTick, reactive, ref } from 'vue';

// 親とInspectorの実際のSFCを使い、共通コントロール・外部アプリ状態・DOMだけを置き換える。
// Commandも本物を使うことで、分割後のイベント接続とUndoの単位を一緒に確認する。
const directory = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
	absWorkingDir: directory,
	stdin: { contents: `
		export { default as Timeline } from './src/components/GsTimeline.vue';
		export { default as Inspector } from './src/components/GsTimeline.Inspector.vue';
		export { appContext } from '@/app.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { getTimelineEditorState } from './src/utility/timeline-editor-state.ts';
		export { createInlineVisualModuleLayer } from './src/utility/inline-visual-module-layer.ts';
		export { videoHoldTest } from '@/utility/timeline-video-hold.ts';
		export { dropUiTest } from '@/ui.ts';
		export { startDragSession, finishDragSession } from './src/utility/drag-and-drop.ts';
	`, resolveDir: directory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [{ name: 'timeline-inspector', setup(build) {
		build.onResolve({ filter: /^@\/app\.ts$/ }, () => ({ path: 'app', namespace: 'test' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onResolve({ filter: /ui\.ts$/ }, () => ({ path: 'ui', namespace: 'test' }));
		build.onResolve({ filter: /^@\/utility\/(timeline-clip-media|visual-module-file)\.ts$/ }, () => ({ path: 'media', namespace: 'test' }));
		build.onResolve({ filter: /^@\/utility\/timeline-video-hold\.ts$/ }, () => ({ path: 'video-hold', namespace: 'test' }));
		build.onResolve({ filter: /\.vue$/ }, ({ path }) => {
			if (/GsTimeline(?:\.Inspector(?:\.(?:Clip|Keyframe|Layer))?)?\.vue$/.test(path)) return;
			return { path: basename(path, '.vue'), namespace: 'control' };
		});
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: {
			app: `import { ref } from 'vue'; export const appContext = {
				projectContext: { stateManager: null, getVisualModuleById: () => null }, activeSceneId: ref('scene'),
				previewPlayback: { state: ref({ mode: 'timeline' }), currentTimelineTime: ref(0), isTimelinePlaying: ref(false) },
				timelineAudioPreview: { buffering: ref(false), error: ref(null) },
				timelineRendererManagerController: { errorMessage: ref(null), getLayerEffectStates() {}, getEffectLayerState() {} },
			};`,
			effects: 'export const effectDefinitions = {};',
			preferences: `import { ref } from 'vue'; export const preferences = { s: { forceTypeSafety: true },
				model: key => ref(key === 'timelineTickMode' ? 'binary' : false) };`,
			ui: `export const dropUiTest = { dialogs: 0 };
				export function progress() { dropUiTest.dialogs++; return { setProgress() {}, setSubProgress() {}, setText() {}, done() {} }; }
				export function popupMenu() {} export function popup() {} export function alert() {} export function select() {} export function confirm() {}`,
			media: 'export async function inspectTimelineClipMedia() { return { durationMs: 5000, audioAvailable: true }; } export async function exportVisualModuleFile() {}',
			'video-hold': `export const videoHoldTest = { calls: [], read: null };
				export async function readTimelineVideoHoldFrame(blob, sourceTimeMs, reverse) {
					videoHoldTest.calls.push({ blob, sourceTimeMs, reverse });
					return videoHoldTest.read ? videoHoldTest.read() : { sourceTimeMs: Math.floor(sourceTimeMs / 100) * 100, sourceDurationMs: 5000 };
				}`,
		}[path] }));
		build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ loader: 'ts', contents: `
			import { h } from 'vue'; export default { inheritAttrs: false, setup(_, { attrs, slots }) {
				return () => h(${JSON.stringify(path)}, attrs, ${path === 'GsVirtualScroll'
					? '(attrs.items ?? []).flatMap((item, index) => slots.default({ item, index }))'
					: 'Object.values(slots).flatMap(slot => slot())'});
			} };` }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const source = await readFile(path, 'utf8');
			const descriptor = parse(source, { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: basename(path), inlineTemplate: true, genDefaultAs: 'component' }).content;
			const classes = Object.fromEntries([...source.matchAll(/\.([A-Za-z]\w*)\s*\{/g)].map(match => [match[1], match[1]]));
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}
				component.__cssModules = { $style: ${JSON.stringify(classes)} }; export default component;` };
		});
	} }],
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { Timeline, Inspector, appContext, COMMAND_DEFS, UndoRedo, getTimelineEditorState, createInlineVisualModuleLayer, videoHoldTest, dropUiTest } = bundled.exports;
const { startDragSession, finishDragSession } = bundled.exports;
let dragWindow = null;

function element(tag = 'div') { return { tag, parent: null, children: [], props: {}, text: '', offsetWidth: 1000, offsetHeight: 500, ownerDocument: { defaultView: dragWindow } }; }

const renderer = createRenderer({
	createElement: element, createText: text => ({ ...element('text'), text }), createComment: () => element('comment'),
	setText: (node, text) => { node.text = text; }, setElementText: (node, text) => { node.text = text; },
	patchProp: (node, key, _old, value) => { node.props[key] = value; },
	insert(node, parent, anchor = null) {
		if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
		parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, node);
		node.parent = parent;
	},
	remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
	parentNode: node => node.parent,
	nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
});

function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }

function textContent(node) { return node.text + node.children.map(textContent).join(''); }

// 【Timeline全体に素材ドロップの表示を出し、子要素間の移動やフォントにも対応する】
// 行の並び替えは通過させ、素材ドロップだけをAppやレイヤー行へ伝播させない。
// 既存Assetはドロップ後に複製せず最上段へ配置し、配置対象外のAssetは履歴を作らない。
test('shows the full timeline drop overlay and consumes only file and asset drags', async t => {
	const f = await fixture(t, Timeline);
	const target = descendants(f.root).find(node => node.props.onDropCapture != null);
	const overlay = () => descendants(f.root).find(node => 'data-test-timeline-drop-overlay' in node.props);

	function event(types, assetId = 'sound') {
		const transfer = layerDragTransfer();
		for (const type of types) transfer.setData(type, '');
		const value = layerDragEvent(transfer, 90, 'dragover');
		if (types.includes('glitch-studio/gsasset')) startDragSession(value, 'test-asset', 'GsAsset', { assetId });
		const drop = () => { transfer.allowReading(); return layerDragEvent(transfer); };
		let stopped = false;
		value.stopPropagation = () => { stopped = true; };
		return { value, drop, isStopped: () => stopped };
	}

	const internal = event(['glitch-studio/gsdraggable']);
	target.props.onDragoverCapture(internal.value);
	assert.equal(internal.value.defaultPrevented, false);
	assert.equal(internal.isStopped(), false);
	assert.equal(overlay(), undefined);
	// カスタム型が先頭にない場合もGsAssetとして受け付ける。
	const asset = event(['text/plain', 'glitch-studio/gsasset']);
	target.props.onDragenterCapture(asset.value);
	target.props.onDragenterCapture(asset.value);
	target.props.onDragleaveCapture(asset.value);
	await nextTick();
	assert.ok(overlay());
	assert.equal(asset.isStopped(), true);
	assert.equal(asset.value.dataTransfer.dropEffect, 'copy');
	await target.props.onDropCapture(asset.drop());
	await nextTick();
	assert.equal(overlay(), undefined);
	assert.equal(f.scene.layers[0].clips[0].assetId, 'sound');
	assert.equal(f.scene.layers[0].clips[0].startMs, 0);
	assert.equal(f.scene.layers.length, 3);
	assert.equal(f.history.state.assets.value.length, 1);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.equal(dropUiTest.dialogs, 1);
	f.history.state.assets.value.push({ id: 'font', name: 'Font', fileDataType: 'font/ttf', fileData: new Blob() });
	const font = event(['glitch-studio/gsasset'], 'font');
	target.props.onDragenterCapture(font.value);
	await nextTick();
	assert.ok(overlay());
	await target.props.onDropCapture(font.drop());
	assert.equal(f.history.undoStack.value.length, 1);
	assert.equal(dropUiTest.dialogs, 1);
	const files = event(['Files']);
	target.props.onDragenterCapture(files.value);
	await nextTick();
	assert.ok(overlay());
	target.props.onDragleaveCapture(files.value);
	await nextTick();
	assert.equal(overlay(), undefined);
});
function layerDragTransfer() {
	const values = new Map();
	let readable = false;
	return {
		files: [],
		get types() { return [...values.keys()]; },
		setData: (type, value) => values.set(type, value),
		getData(type) { assert.equal(readable, true, 'Drag data must only be read on drop'); return values.get(type) ?? ''; },
		values, allowReading: () => { readable = true; },
	};
}

function layerDragEvent(transfer, clientY = 90, type = 'drop') {
	const event = new Event(type, { cancelable: true });
	event.dataTransfer = transfer;
	event.clientY = clientY;
	Object.defineProperty(event, 'currentTarget', { value: { ownerDocument: { defaultView: dragWindow }, getBoundingClientRect: () => ({ top: 0, height: 100 }) } });
	return event;
}

// 【レイヤーの型付きドラッグデータで並び替え、Undo/Redoとドラッグ元のDOM保持を維持する】
// dragover中にデータ本体を読めない制約を再現し、ローカル状態で位置を計算できることを確認する。
// text/plainへ内部IDを書き出さず、Sceneとレイヤーの参照だけをドロップ時に受け渡す。
test('reorders layers with typed drag data while preserving undo and the mounted source', async t => {
	const f = await fixture(t, Timeline);
	const row = id => f.controls('GsTimeline.Layer').find(node => node.props['data-test-timeline-layer'] === id);
	const transfer = layerDragTransfer();
	row('a').props.onDragStart(layerDragEvent(transfer, 90, 'dragstart'));
	assert.equal(transfer.types.includes('glitch-studio/timelinelayer'), true);
	assert.equal(transfer.types.includes('text/plain'), false);
	assert.deepEqual(JSON.parse(transfer.values.get('glitch-studio/timelinelayer')), { sceneId: 'scene', layerId: 'a' });
	assert.equal(transfer.effectAllowed, 'move');
	await new Promise(resolve => setTimeout(resolve, 20));
	await nextTick();
	assert.deepEqual(f.control('GsVirtualScroll').props.keepMountedKeys, ['a']);
	const over = layerDragEvent(transfer, 90, 'dragover');
	row('b').props.onDragover(over);
	assert.equal(over.defaultPrevented, true);
	assert.equal(transfer.dropEffect, 'move');
	transfer.allowReading();
	row('b').props.onDrop(layerDragEvent(transfer));
	await nextTick();
	assert.deepEqual(f.scene.layers.map(layer => layer.id), ['b', 'a']);
	assert.deepEqual(f.control('GsVirtualScroll').props.keepMountedKeys, []);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual(f.scene.layers.map(layer => layer.id), ['a', 'b']);
	f.history.redo();
	assert.deepEqual(f.scene.layers.map(layer => layer.id), ['b', 'a']);
});

// 【別Scene・別レイヤー・他種別のドロップやドラッグ開始のない操作では並び替えない】
// ホバー時の候補が残っていても、不一致のデータで前回のドラッグ元を移動しない。
// 同じSceneを表示する別Timelineからのドロップも、ローカル状態がなければ受け付けない。
test('rejects unrelated drops and layer payloads that do not match the local drag', async t => {
	const f = await fixture(t, Timeline);
	const row = id => f.controls('GsTimeline.Layer').find(node => node.props['data-test-timeline-layer'] === id);
	for (const payload of [null, { sceneId: 'other-scene', layerId: 'a' }, { sceneId: 'scene', layerId: 'b' }]) {
		const transfer = layerDragTransfer();
		row('a').props.onDragStart(layerDragEvent(transfer, 90, 'dragstart'));
		row('b').props.onDragover(layerDragEvent(transfer, 90, 'dragover'));
		if (payload == null) {
			transfer.values.clear();
			transfer.setData('text/plain', 'a');
		} else transfer.setData('glitch-studio/timelinelayer', JSON.stringify(payload));
		transfer.allowReading();
		row('b').props.onDrop(layerDragEvent(transfer));
		await nextTick();
		assert.deepEqual(f.scene.layers.map(layer => layer.id), ['a', 'b']);
		assert.equal(f.history.undoStack.value.length, 0);
		assert.deepEqual(f.control('GsVirtualScroll').props.keepMountedKeys, []);
	}
	const foreign = layerDragTransfer();
	foreign.setData('glitch-studio/timelinelayer', JSON.stringify({ sceneId: 'scene', layerId: 'a' }));
	const over = layerDragEvent(foreign, 90, 'dragover');
	row('b').props.onDragover(over);
	assert.equal(over.defaultPrevented, false);
	foreign.allowReading();
	row('b').props.onDrop(layerDragEvent(foreign));
	assert.equal(f.history.undoStack.value.length, 0);
	const cancelled = layerDragTransfer();
	row('a').props.onDragStart(layerDragEvent(cancelled, 90, 'dragstart'));
	row('b').props.onDragover(layerDragEvent(cancelled, 90, 'dragover'));
	dragWindow.dispatchEvent(new Event('dragend'));
	cancelled.allowReading();
	row('b').props.onDrop(layerDragEvent(cancelled));
	assert.equal(f.history.undoStack.value.length, 0);
});

const keySelection = (layerId, keyframeId) => ({ layerId, target: 'audio', paramPath: ['volume'], keyframeId });
const makeLayer = id => ({ id, name: id, layerType: 'audio', isDisabled: false, automationGraphs: [],
																											clips: [{ id: 'clip', assetId: 'sound', startMs: 0, durationMs: 5000, sourceInMs: 0, sourceOutMs: 5000, playbackRate: 1, loop: false }],
																											audioParamValues: { volume: { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null, keyframesTimeline: {
																												dataType: { kind: 'scalar' }, isNormalized: false,
																												keyframes: [100, 300, 600].map((x, index) => ({ id: `key-${index}`, x, value: 1, interpolation: { type: 'linear' } })),
																											} } },
});

// 【動画の詳細から全体長と素材範囲を別々に変更し、ループ解除をUndoできる】
// 数値入力が通常の右トリムへ誤接続されると、全体長の変更でループ範囲まで変わってしまう。
test('edits video total duration independently of the trimmed range in the inspector', async t => {
	const f = await fixture(t);
	const layer = f.scene.layers[0];
	layer.layerType = 'video';
	layer.compositingParamValues = {};
	Object.assign(layer.clips[0], { audioEnabled: false });
	f.props.selection = { kind: 'clips', clips: [{ layerId: 'a', clipId: 'clip' }] };
	f.props.mediaInfo = new Map([['sound', { durationMs: 5000, audioAvailable: true, audioError: null }]]);
	await nextTick();
	f.control('GsInput', 'Total duration').props['onUpdate:modelValue'](13000);
	await nextTick();
	assert.deepEqual([layer.clips[0].durationMs, (layer.clips[0].loop ? layer.clips[0].sourceOutMs - layer.clips[0].sourceInMs : null)], [13000, 5000]);
	f.control('GsInput', 'Trimmed duration').props['onUpdate:modelValue'](3000);
	await nextTick();
	assert.deepEqual([layer.clips[0].durationMs, (layer.clips[0].loop ? layer.clips[0].sourceOutMs - layer.clips[0].sourceInMs : null)], [13000, 3000]);
	f.control('GsButton', 'Remove loop').props.onClick();
	await nextTick();
	assert.deepEqual([layer.clips[0].durationMs, (layer.clips[0].loop ? layer.clips[0].sourceOutMs - layer.clips[0].sourceInMs : null)], [3000, null]);
	f.history.undo();
	assert.deepEqual([layer.clips[0].durationMs, (layer.clips[0].loop ? layer.clips[0].sourceOutMs - layer.clips[0].sourceInMs : null)], [13000, 3000]);
});

// 【Inspectorから速度と逆再生を設定し、衝突する変更は適用させない】
// 実際のSFCの入力・ボタンとCommandを結び、表示だけが変わって再生設定が保存されない不具合を防ぐ。
// 音声クリップでも同じ操作を使い、キーフレームはScene時刻に残す。
test('applies speed and reverse controls and previews collision errors', async t => {
	const f = await fixture(t);
	const layer = f.scene.layers[0];
	const clip = layer.clips[0];
	const original = structuredClone({ ...clip });
	const keyTimes = layer.audioParamValues.volume.keyframesTimeline.keyframes.map(key => key.x);
	f.props.selection = { kind: 'clips', clips: [{ layerId: 'a', clipId: 'clip' }] };
	f.props.mediaInfo = new Map([['sound', { durationMs: 5000, audioAvailable: true, audioError: null }]]);
	await nextTick();
	f.control('GsInput', 'Speed').props['onUpdate:modelValue'](50);
	await nextTick();
	assert.equal(f.control('GsButton', 'Apply speed').props.disabled, false);
	f.control('GsButton', 'Apply speed').props.onClick();
	await nextTick();
	assert.equal(clip.durationMs, 10000);
	f.control('GsSwitch', 'Reverse playback').props['onUpdate:modelValue'](true);
	await nextTick();
	f.control('GsButton', 'Apply speed').props.onClick();
	await nextTick();
	assert.equal(clip.playbackRate, -0.5);
	assert.deepEqual(layer.audioParamValues.volume.keyframesTimeline.keyframes.map(key => key.x), keyTimes);
	f.history.undo();
	f.history.undo();
	await nextTick();
	assert.deepEqual({ ...clip }, original);
	layer.clips.push({ ...clip, id: 'next', startMs: 6000 });
	f.control('GsInput', 'Speed').props['onUpdate:modelValue'](50);
	await nextTick();
	assert.equal(f.control('GsButton', 'Apply speed').props.disabled, true);
	assert.ok(textContent(f.root).includes('Overlapping clips'));
});

async function fixture(t, component = Inspector) {
	dragWindow = new EventTarget();
	t.after(() => finishDragSession('test-asset'));
	dropUiTest.dialogs = 0;
	videoHoldTest.calls = [];
	videoHoldTest.read = null;
	appContext.previewPlayback.currentTimelineTime.value = 0;
	t.mock.method(console, 'log', () => {});
	const previousResizeObserver = globalThis.ResizeObserver;
	const previousHTMLElement = globalThis.HTMLElement;
	globalThis.ResizeObserver = class { observe() {} disconnect() {} };
	globalThis.HTMLElement = class {};
	t.after(() => { globalThis.ResizeObserver = previousResizeObserver; globalThis.HTMLElement = previousHTMLElement; });
	const state = { timelineScenes: ref([{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [makeLayer('a'), makeLayer('b')] }]),
																	assets: ref([{ id: 'sound', name: 'Sound', fileDataType: 'audio/wav', fileData: new Blob() }]), visualModules: ref([]),
																	players: ref([]), generatedSpeech: ref([]), resolution: ref({ width: 1920, height: 1080 }), timelineFps: ref(30) };
	const history = new UndoRedo(state, COMMAND_DEFS);
	appContext.projectContext.stateManager = history;
	const scene = state.timelineScenes.value[0];
	const props = reactive({ scene, sceneId: scene.id, selection: { kind: 'keyframes', keyframes: [keySelection('a', 'key-1')] },
																										mediaInfo: new Map(), subPanelTarget: null });
	const events = [];
	const root = element();
	const app = renderer.createApp({ setup: () => () => h(component, {
		...(component === Timeline ? {
			sceneId: props.sceneId, subPanelTarget: props.subPanelTarget,
			onRevealDetails: () => events.push(['revealDetails']),
		} : {
			scene: props.scene, selection: props.selection, mediaInfo: props.mediaInfo,
			onSelectKeyframe: value => events.push(['selectKeyframe', value]),
			onRemoveKeyframes: () => events.push(['removeKeyframes']), onRemoveClips: () => events.push(['removeClips']),
			onChangeClipSource: value => events.push(['changeClipSource', value]),
			onRequestAddInlineEffectNode: value => events.push(['addEffect', value]),
		}),
	}) });
	app.directive('tooltip', {});
	app.mount(root);
	t.after(() => app.unmount());
	await nextTick();
	const controls = tag => descendants(root).filter(node => node.tag === tag);
	const control = (tag, label) => controls(tag).find(node => label == null || textContent(node).includes(label));
	return { props, scene, history, events, root, controls, control };
}

// 【Inspectorで現在地点を固定し、地点と表示長を編集してUndoで通常再生へ戻せる】
// 逆再生・ループからの素材時刻と方向をフレーム読取へ渡し、固定後は音声・速度・ループの
// 操作を使わせない。固定地点の数値変更はフレームを選び直し、表示区間を変えない。
test('holds the current source frame and edits hold time and duration in the inspector', async t => {
	const f = await fixture(t);
	const layer = f.scene.layers[0];
	layer.layerType = 'video';
	layer.compositingParamValues = {};
	const clip = layer.clips[0];
	Object.assign(clip, { audioEnabled: true, sourceInMs: 1000, sourceOutMs: 2000, playbackRate: -0.5, loop: true });
	const original = { ...clip };
	f.props.selection = { kind: 'clips', clips: [{ layerId: 'a', clipId: 'clip' }] };
	f.props.mediaInfo = new Map([['sound', { durationMs: 5000, audioAvailable: true, audioError: null }]]);
	appContext.previewPlayback.currentTimelineTime.value = 2500;
	await nextTick();
	f.control('GsButton', 'Hold current frame').props.onClick();
	await nextTick();
	await nextTick();
	assert.deepEqual([videoHoldTest.calls[0].sourceTimeMs, videoHoldTest.calls[0].reverse], [1750, true]);
	assert.equal(clip.sourceTimeMs, 1700);
	assert.equal(clip.durationMs, 5000);
	assert.equal(f.control('GsSwitch', 'Audio enabled').props.disabled, true);
	assert.equal(f.control('GsInput', 'Speed'), undefined);
	assert.equal(f.control('GsInput', 'Total duration'), undefined);
	f.control('GsInput', 'Hold source time').props['onUpdate:modelValue'](2345);
	await nextTick();
	await nextTick();
	assert.equal(clip.sourceTimeMs, 2300);
	f.control('GsInput', 'Duration').props['onUpdate:modelValue'](15000);
	await nextTick();
	assert.equal(clip.durationMs, 15000);
	assert.equal(clip.sourceTimeMs, 2300);
	f.history.undo();
	f.history.undo();
	f.history.undo();
	await nextTick();
	assert.deepEqual({ ...clip }, original);
	assert.equal(f.control('GsButton', 'Hold current frame').props.disabled, false);
	appContext.previewPlayback.currentTimelineTime.value = 5000;
	await nextTick();
	assert.equal(f.control('GsButton', 'Hold current frame').props.disabled, true);
});

// 【デコード待機中の古い固定操作を別クリップ・変更済み素材へ適用しない】
// 動画のデコードは非同期なので、選択変更やトリムの後に古い地点を保存する競合を防ぐ。
// 対象フレームがない場合も設定・履歴を変更せず、Inspectorに理由を表示する。
test('discards stale hold results and reports missing frames without changing history', async t => {
	for (const change of ['selection', 'timing', 'asset', 'error']) {
		const f = await fixture(t);
		const layer = f.scene.layers[0];
		layer.layerType = 'video';
		layer.compositingParamValues = {};
		const clip = layer.clips[0];
		clip.audioEnabled = true;
		f.props.selection = { kind: 'clips', clips: [{ layerId: 'a', clipId: 'clip' }] };
		f.props.mediaInfo = new Map([['sound', { durationMs: 5000, audioAvailable: true }]]);
		let resolve, reject;
		videoHoldTest.read = () => new Promise((done, failed) => { resolve = done; reject = failed; });
		await nextTick();
		f.control('GsButton', 'Hold current frame').props.onClick();
		if (change === 'selection') f.props.selection = { kind: 'layers', ids: ['b'] };
		if (change === 'timing') clip.durationMs = 3000;
		if (change === 'asset') f.history.state.assets.value[0].fileData = new Blob(['replacement']);
		await nextTick();
		if (change === 'error') reject(new Error('There is no video frame at this source time.'));
		else resolve({ sourceTimeMs: 0, sourceDurationMs: 5000 });
		await new Promise(resolve => setImmediate(resolve));
		await nextTick();
		assert.equal('sourceTimeMs' in clip, false);
		assert.equal(f.history.undoStack.value.length, 0);
		if (change === 'error') assert.ok(textContent(f.root).includes('There is no video frame'));
	}
});

// 【キーの詳細編集は連続変更を一回のUndoにまとめ、直前のキーの補間も編集できる】
// 分割でmergeKeyや編集先のIDが失われると、値を戻せなくなったり選択中のキーだけを書き換えてしまう。
test('preserves keyframe edit history and edits interpolation owned by the previous key', async t => {
	const f = await fixture(t);
	const keys = () => f.scene.layers[0].audioParamValues.volume.keyframesTimeline.keyframes;
	f.control('GsLiteralLeafValueControl').props.onBeginChanging();
	f.control('GsLiteralLeafValueControl').props.onChangeContinuous(2);
	await nextTick();
	f.control('GsLiteralLeafValueControl').props.onChangeContinuous(3);
	f.control('GsLiteralLeafValueControl').props.onChangeFinished();
	await nextTick();
	assert.equal(keys()[1].value, 3);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.equal(keys()[1].value, 1);
	f.history.redo();
	assert.equal(keys()[1].value, 3);
	await nextTick();
	f.control('GsSelect', 'Interpolation from previous keyframe').props['onUpdate:modelValue']('ease:sine');
	assert.deepEqual(keys()[0].interpolation, { type: 'ease:sine', direction: 'inOut' });
	assert.deepEqual(keys()[1].interpolation, { type: 'linear' });
	await nextTick();
	f.control('GsInput', 'Time').props['onUpdate:modelValue'](590);
	assert.equal(keys()[1].x, 500);
});

// 【詳細は選択の種類と所属レイヤーを反映し、選択自体は変更しない】
// 複数選択で最初のレイヤーを誤って編集したり、キー変更後に前のキーの連続編集へ履歴を統合しない。
test('routes selection-specific details and resets continuous edits when the selected key changes', async t => {
	const f = await fixture(t);
	f.control('GsLiteralLeafValueControl').props.onBeginChanging();
	f.control('GsLiteralLeafValueControl').props.onChangeContinuous(2);
	f.props.selection = { kind: 'keyframes', keyframes: [keySelection('b', 'key-1')] };
	await nextTick();
	f.control('GsLiteralLeafValueControl').props.onChangeContinuous(4);
	assert.equal(f.history.undoStack.value.length, 2);
	f.props.selection = { kind: 'keyframes', keyframes: [keySelection('a', 'key-0'), keySelection('b', 'key-1')] };
	await nextTick();
	assert.equal(f.controls('GsLiteralLeafValueControl').length, 0);
	assert.equal(f.control('GsInput', 'Layer Name'), undefined);
	f.control('GsButton', 'Remove Keyframes').props.onClick();
	assert.deepEqual(f.events, [['removeKeyframes']]);
	assert.equal(f.props.selection.keyframes.length, 2);
});

// 【素材長を取得してからトリムを許可し、素材変更は正しいクリップを親へ通知する】
// 詳細の分割後も素材未読込時の制限を守り、同じクリップIDが別レイヤーに存在しても対象を混同しない。
test('waits for media metadata before trimming and forwards the clip identity', async t => {
	const f = await fixture(t);
	f.props.selection = { kind: 'clips', clips: [{ layerId: 'b', clipId: 'clip' }] };
	await nextTick();
	assert.equal(f.control('GsInput', 'Trimmed duration').props.disabled, true);
	f.control('GsInput', 'Trimmed duration').props['onUpdate:modelValue'](4000);
	assert.equal(f.history.undoStack.value.length, 0);
	f.props.mediaInfo = new Map([['sound', { durationMs: 5000, audioAvailable: true, audioError: null }]]);
	await nextTick();
	assert.equal(f.control('GsInput', 'Trimmed duration').props.disabled, false);
	f.control('GsInput', 'Trimmed duration').props['onUpdate:modelValue'](4000);
	assert.equal(f.scene.layers[1].clips[0].durationMs, 4000);
	assert.equal(f.scene.layers[0].clips[0].durationMs, 5000);
	f.control('GsButton', 'Change source').props.onClick();
	f.control('GsButton', 'Remove Clip').props.onClick();
	assert.deepEqual(f.events, [['changeClipSource', { layerId: 'b', clipId: 'clip' }], ['removeClips']]);
	f.history.undo();
	assert.equal(f.scene.layers[1].clips[0].durationMs, 5000);
});

// 【詳細を閉じたままでも選択の検証とDeleteが働く】
// 選択の寿命をInspectorへ移すと、非表示時に古いキーが残ったりショートカットが使えなくなる。
// 実際の親SFCで、編集不能になったキーからレイヤーへ戻る処理とキー削除を確認する。
test('keeps selection validation and delete shortcuts active without an inspector', async t => {
	const f = await fixture(t, Timeline);
	const editor = getTimelineEditorState(f.scene);
	editor.selection = { kind: 'keyframes', keyframes: [keySelection('a', 'key-1')] };
	await nextTick();
	f.scene.layers[0].audioParamValues.volume.keyframesTimeline.dataType = { kind: 'boolean' };
	await nextTick();
	assert.deepEqual(editor.selection, { kind: 'layers', ids: ['a'] });
	editor.selection = { kind: 'keyframes', keyframes: [keySelection('b', 'key-1')] };
	await nextTick();
	const root = descendants(f.root).find(node => node.props.onKeydown);
	await root.props.onKeydown({ key: 'Delete', target: null, preventDefault() {}, stopPropagation() {} });
	assert.deepEqual(f.scene.layers[1].audioParamValues.volume.keyframesTimeline.keyframes.map(key => key.id), ['key-0', 'key-2']);
	assert.deepEqual(f.events, []);
});

// 【レイヤー詳細は選択先を編集し、Visual Moduleのエフェクト追加先を親へ伝える】
// 設定UIの移動で古いレイヤーを編集したり、ピッカーの対象が現在の選択に暗黙に依存することを防ぐ。
test('edits layer parameters through commands and identifies the inline Visual Module for effect insertion', async t => {
	const f = await fixture(t);
	f.props.selection = { kind: 'layers', ids: ['b'] };
	await nextTick();
	f.control('GsInput', 'Layer Name').props['onUpdate:modelValue']('Renamed');
	f.control('GsVisualParam').props.onEdit({ kind: 'literal', paramPath: ['volume'], value: 0.5 });
	assert.equal(f.scene.layers[1].name, 'Renamed');
	assert.deepEqual(f.scene.layers[1].audioParamValues.volume, { inputSource: 'literal', value: 0.5 });
	assert.equal(f.scene.layers[0].audioParamValues.volume.inputSource, 'keyframesTimelineInline');
	f.history.undo();
	assert.equal(f.scene.layers[1].audioParamValues.volume.inputSource, 'keyframesTimelineInline');
	const layer = createInlineVisualModuleLayer(0);
	f.scene.layers.push(layer);
	f.props.selection = { kind: 'layers', ids: [layer.id] };
	await nextTick();
	f.control('GsVisualModuleEditor').props.onRequestAddEffectNode();
	assert.deepEqual(f.events, [['addEffect', layer.id]]);
});

// 【インラインEditorの素材ドロップを、詳細パネルが正しい保存先のCommandへ接続する】
// 共通Editorへ渡した処理が登録済みVisual Moduleを編集したり、新しいタイムラインレイヤーを作らない。
// Assetと対応Player・音声ノードの関係を実際の親SFCとCommandで確認する。
test('routes inline editor asset drops into the selected Visual Module', async t => {
	const f = await fixture(t);
	const layer = createInlineVisualModuleLayer(0);
	f.scene.layers.push(layer);
	f.props.selection = { kind: 'layers', ids: [layer.id] };
	await nextTick();
	const editor = f.control('GsVisualModuleEditor');
	const originalCount = layer.visualModule.nodes.length;
	assert.equal(await editor.props.assetDropActions.dropAsset('sound'), true);
	assert.equal(f.scene.layers.length, 3);
	assert.equal(layer.visualModule.nodes.length, originalCount + 1);
	const node = layer.visualModule.nodes.find(node => node.type === 'effect' && node.effectId === 'audioWaveform');
	assert.equal(node.params.audio.value.playerId, f.history.state.players.value[0].id);
	assert.equal(f.history.state.players.value[0].assetId, 'sound');
	f.history.undo();
	assert.equal(layer.visualModule.nodes.length, originalCount);
	assert.equal(f.history.state.players.value.length, 0);
});

// 【詳細パネルを閉じて開き直しても選択を保持し、削除ボタンは親の操作へ接続される】
// TeleportとInspectorの境界を実際に通し、単体では動いても親へイベントが届かない退行を防ぐ。
// 表示の切り替え自体からrevealDetailsを出さず、手動で閉じたパネルを再表示しない。
test('preserves selection across inspector visibility changes and routes removal back to the timeline', async t => {
	const f = await fixture(t, Timeline);
	const editor = getTimelineEditorState(f.scene);
	editor.selection = { kind: 'keyframes', keyframes: [keySelection('a', 'key-1')] };
	const target = markRaw(element());
	f.props.subPanelTarget = target;
	await nextTick();
	assert.ok(descendants(target).some(node => node.tag === 'GsLiteralLeafValueControl'));
	f.props.subPanelTarget = null;
	await nextTick();
	assert.deepEqual(editor.selection, { kind: 'keyframes', keyframes: [keySelection('a', 'key-1')] });
	assert.ok(!descendants(target).some(node => node.tag === 'GsLiteralLeafValueControl'));
	f.props.subPanelTarget = target;
	await nextTick();
	const remove = descendants(target).find(node => node.tag === 'GsButton' && textContent(node).includes('Remove Keyframe'));
	remove.props.onClick();
	assert.deepEqual(f.scene.layers[0].audioParamValues.volume.keyframesTimeline.keyframes.map(key => key.id), ['key-0', 'key-2']);
	assert.deepEqual(editor.selection, { kind: 'layers', ids: ['a'] });
	assert.deepEqual(f.events, []);
});
