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
	`, resolveDir: directory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [{ name: 'timeline-inspector', setup(build) {
		build.onResolve({ filter: /^@\/app\.ts$/ }, () => ({ path: 'app', namespace: 'test' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onResolve({ filter: /^@\/ui\.ts$/ }, () => ({ path: 'ui', namespace: 'test' }));
		build.onResolve({ filter: /^@\/utility\/(timeline-clip-media|visual-module-file)\.ts$/ }, () => ({ path: 'media', namespace: 'test' }));
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
			ui: 'export function popupMenu() {} export function popup() {} export function alert() {} export function select() {} export function confirm() {}',
			media: 'export async function inspectTimelineClipMedia() { return { durationMs: 5000, audioAvailable: true }; } export async function exportVisualModuleFile() {}',
		}[path] }));
		build.onLoad({ filter: /.*/, namespace: 'control' }, ({ path }) => ({ loader: 'ts', contents: `
			import { h } from 'vue'; export default { inheritAttrs: false, setup(_, { attrs, slots }) {
				return () => h(${JSON.stringify(path)}, attrs, ${path === 'GsVirtualScroll' ? '[]' : 'Object.values(slots).flatMap(slot => slot())'});
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
const { Timeline, Inspector, appContext, COMMAND_DEFS, UndoRedo, getTimelineEditorState, createInlineVisualModuleLayer } = bundled.exports;

function element(tag = 'div') { return { tag, parent: null, children: [], props: {}, text: '', offsetWidth: 1000, offsetHeight: 500 }; }
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
const keySelection = (layerId, keyframeId) => ({ layerId, target: 'audio', paramPath: ['volume'], keyframeId });
const makeLayer = id => ({ id, name: id, layerType: 'audio', isDisabled: false, automationGraphs: [],
	clips: [{ id: 'clip', assetId: 'sound', startMs: 0, durationMs: 5000, contentOffsetMs: 0 }],
	audioParamValues: { volume: { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null, keyframesTimeline: {
		dataType: { kind: 'scalar' }, isNormalized: false,
		keyframes: [100, 300, 600].map((x, index) => ({ id: `key-${index}`, x, value: 1, interpolation: { type: 'linear' } })),
	} } },
});

async function fixture(t, component = Inspector) {
	t.mock.method(console, 'log', () => {});
	const previousResizeObserver = globalThis.ResizeObserver;
	const previousHTMLElement = globalThis.HTMLElement;
	globalThis.ResizeObserver = class { observe() {} disconnect() {} };
	globalThis.HTMLElement = class {};
	t.after(() => { globalThis.ResizeObserver = previousResizeObserver; globalThis.HTMLElement = previousHTMLElement; });
	const state = { timelineScenes: ref([{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [makeLayer('a'), makeLayer('b')] }]),
		assets: ref([{ id: 'sound', name: 'Sound', fileDataType: 'audio/wav', fileData: new Blob() }]), visualModules: ref([]),
		generatedSpeech: ref([]), resolution: ref({ width: 1920, height: 1080 }), timelineFps: ref(30) };
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
	assert.equal(f.control('GsInput', 'Duration').props.disabled, true);
	f.control('GsInput', 'Duration').props['onUpdate:modelValue'](4000);
	assert.equal(f.history.undoStack.value.length, 0);
	f.props.mediaInfo = new Map([['sound', { durationMs: 5000, audioAvailable: true, audioError: null }]]);
	await nextTick();
	assert.equal(f.control('GsInput', 'Duration').props.disabled, false);
	f.control('GsInput', 'Duration').props['onUpdate:modelValue'](4000);
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
