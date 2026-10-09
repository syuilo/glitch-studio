import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive, ref } from 'vue';

// ブラウザーを起動せず、本物のSFCの更新回数・生成する座標・イベントを検証する。
// 外部アプリ状態と文字の縮小表示だけを置き換え、一覧・クリップ・キー・目盛りは実装を使う。
const directory = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
	absWorkingDir: directory,
	stdin: { contents: "export { default as Layer } from './src/components/GsTimeline.Layer.vue'; export * from 'test:metrics'; export * from '@/app.ts'; export * from './src/utility/timeline-coordinates.ts'; export * from './src/utility/timeline-ticks.ts';", resolveDir: directory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [{ name: 'timeline-sfc', setup(build) {
		build.onResolve({ filter: /^test:metrics$/ }, () => ({ path: 'metrics', namespace: 'test' }));
		build.onResolve({ filter: /^@\/app\.ts$/ }, () => ({ path: 'app', namespace: 'test' }));
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /Gs(CondensedLine|Button)\.vue$/ }, () => ({ path: 'label', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: {
			metrics: 'export const updates = new Map(); export const mounts = new Map();',
			app: `import { ref } from 'vue'; export const commits = []; export const appContext = { projectContext: { stateManager: {
				state: { assets: ref([{ id: 'sound', name: 'Sound' }]), timelineScenes: ref([]), visualModules: ref([]), generatedSpeech: ref([]) },
				commit: (...args) => commits.push(args),
			} } };`,
			effects: 'export const effectDefinitions = {};',
			label: "import { h } from 'vue'; export default { setup: (_, { slots }) => () => h('span', slots.default?.()) };",
		}[path] }));
		build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
			const source = await readFile(path, 'utf8');
			const descriptor = parse(source, { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: path, inlineTemplate: true, genDefaultAs: 'component' }).content;
			const classes = Object.fromEntries([...source.matchAll(/\.([A-Za-z]\w*)\s*\{/g)].map(match => [match[1], match[1]]));
			const name = JSON.stringify(basename(path));
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}
				import { updates, mounts } from 'test:metrics';
				component.__cssModules = { $style: ${JSON.stringify(classes)} };
				component.beforeUpdate = () => updates.set(${name}, (updates.get(${name}) ?? 0) + 1);
				component.beforeMount = () => mounts.set(${name}, (mounts.get(${name}) ?? 0) + 1);
				export default component;` };
		});
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { Layer, updates, mounts, commits, timelineKeyframePosition, timelineTimeToX, getTimelineVisibleClipTicks, getTimelineClipTicks } = module.exports;

// Vueのhost操作のみ実装し、レイアウト・ペイント速度を測ったと誤認しないようにする。
function element(tag = 'div') { return { tag, parent: null, children: [], props: {}, getBoundingClientRect: () => ({ left: 100 }) }; }
const renderer = createRenderer({
	createElement: element, createText: () => element('text'), createComment: () => element('comment'),
	setText() {}, setElementText() {},
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
const components = ['GsTimeline.Layer.Clips.vue', 'GsTimeline.Clip.vue', 'GsTimeline.Layer.Keyframes.vue'];

async function fixture(t) {
	const makeLayer = id => ({ id, layerType: 'audio', name: id, isDisabled: false,
		clips: [100, 300, 600].map((startMs, index) => ({ id: 'clip-' + index, assetId: 'sound', startMs, durationMs: 100, contentOffsetMs: 30 })),
		audioParamValues: { volume: { inputSource: 'keyframesTimelineInline', keyframesTimeline: {
			dataType: { kind: 'scalar' }, isNormalized: false,
			keyframes: [100, 200].map((x, index) => ({ id: 'key-' + index, x, value: 1, interpolation: { type: 'linear' } })),
		} } }, automationGraphs: [],
	});
	const layers = reactive(['a', 'b', 'c'].map(makeLayer));
	const visible = ref([0]);
	const props = reactive({ sceneId: 'scene', sceneTimeMs: 0, tlElWidth: 1000, tlRangeX: 500, tlPosX: 0,
		tickMode: 'binary', tickSubdivisions: { halves: true, thirds: false }, mediaInfo: new Map([['sound', { durationMs: 1000 }]]),
		selectedKeyframes: [], selectedClipIds: [], selected: false, moving: false, optimizeHorizontalMovement: false, isLastOfGroup: false,
	});
	const events = [];
	const root = element();
	const app = renderer.createApp({ setup: () => () => h('div', visible.value.map(index => h(Layer, {
		...props, key: layers[index].id, layer: layers[index],
		onAddClip: time => events.push(['addClip', time]),
		onClipMoveStart: (_event, selection) => events.push(['move', selection]),
		onClipTrimStart: (_event, selection, edge) => events.push(['trim', selection, edge]),
		onKeyframeDragStart: (_event, selection) => events.push(['keyMove', selection]),
		onToggleCollapse: () => { props.collapsed = !props.collapsed; },
	}))) });
	app.mount(root);
	t.after(() => app.unmount());
	await nextTick();
	updates.clear(); mounts.clear(); commits.length = 0;
	return { props, layers, visible, root, events };
}

// 【通常レイヤーを折りたたんでもクリップを維持し、再展開でキーと目盛りを復元する】
// キーを隠すだけの操作でデータや選択を失ったり、クリップまで再生成してはならない。
// 実際の開閉ボタンを通して表示とaria-expandedが連動することも確認する。
test('collapses ordinary layers to the main lane and restores keyframes on expansion', async t => {
	const state = await fixture(t);
	state.props.selectedKeyframes = [{ layerId: 'a', target: 'audio', paramPath: ['volume'], keyframeId: 'key-0' }];
	await nextTick();
	const nodes = () => descendants(state.root);
	const toggle = nodes().find(node => node.props.class?.includes('collapseButton'));
	const clip = nodes().find(node => node.props['data-timeline-clip-id'] === 'clip-0');
	const originalKeys = structuredClone(state.layers[0].audioParamValues.volume.keyframesTimeline.keyframes.map(point => ({ ...point, interpolation: { ...point.interpolation } })));
	assert.equal(toggle.props['aria-expanded'], true);
	assert.ok(nodes().some(node => node.props.class === 'localTicksLane'));
	toggle.props.onClick({ stopPropagation() {} });
	await nextTick();
	assert.equal(toggle.props['aria-expanded'], false);
	assert.equal(nodes().find(node => node.props['data-timeline-clip-id'] === 'clip-0'), clip);
	assert.ok(!nodes().some(node => node.props.class === 'localTicksLane' || node.props.class === 'keyframesLane'));
	assert.ok(!nodes().some(node => node.props['data-timeline-keyframe-id']));
	assert.equal(mounts.get('GsTimeline.Clip.vue') ?? 0, 0);
	toggle.props.onClick({ stopPropagation() {} });
	await nextTick();
	assert.equal(toggle.props['aria-expanded'], true);
	assert.ok(nodes().some(node => node.props.class === 'localTicksLane'));
	assert.ok(nodes().some(node => node.props['data-timeline-keyframe-id'] === 'key-0' && node.props.class.includes('selected')));
	assert.deepEqual(state.layers[0].audioParamValues.volume.keyframesTimeline.keyframes, originalKeys);
	assert.equal(commits.length, 0);
});

// 【VOICEVOXの折りたたみでは発話レーンとローカル目盛りも隠す】
// 発話は通常のパラメータキーとは別のレーンなので、通常キーだけの非表示では
// メインレーンだけを残す仕様を満たせない。再展開時の復元も確認する。
test('hides the speech lane and local ruler when a voicevox layer is collapsed', async t => {
	const state = await fixture(t);
	Object.assign(state.layers[0], { layerType: 'voicevox', voicevox: {}, utterances: [], compositingParamValues: {}, subtitleParamValues: {} });
	await nextTick();
	const hasLane = className => descendants(state.root).some(node => node.props.class === className);
	assert.ok(hasLane('speechLane'));
	assert.ok(hasLane('localTicksLane'));
	state.props.collapsed = true;
	await nextTick();
	assert.ok(hasLane('mainLane'));
	assert.ok(!hasLane('speechLane'));
	assert.ok(!hasLane('localTicksLane'));
	assert.ok(!hasLane('keyframesLane'));
	state.props.collapsed = false;
	await nextTick();
	assert.ok(hasLane('speechLane'));
	assert.ok(hasLane('localTicksLane'));
	assert.equal(commits.length, 0);
});

// 【横移動では一覧・クリップ・キーを再評価せず、倍率変更では再配置する】
// propsからtlPosXを外しても親のv-forや選択配列が毎回更新されると効果が失われるため、
// 実際のコンポーネント境界を通して更新回数を確認する。
// 移動の開始・終了で描画のヒントを切り替えても、子の再評価を発生させない。
test('pans by updating parent transforms without rerendering clips or keyframes', async t => {
	const state = await fixture(t);
	const translated = descendants(state.root).filter(node => node.props.class === 'scrollingContent');
	assert.equal(translated.length, 2);
	assert.ok(translated.every(node => node.props.style.willChange === 'auto'));
	state.props.optimizeHorizontalMovement = true;
	await nextTick();
	assert.ok(translated.every(node => node.props.style.willChange === 'transform'));
	for (const position of [10.25, -50, 180, 0]) { state.props.tlPosX = position; await nextTick(); }
	assert.ok(updates.get('GsTimeline.Layer.vue') > 0);
	for (const name of components) assert.equal(updates.get(name) ?? 0, 0, name);
	state.props.tlPosX = 40.25;
	await nextTick();
	assert.ok(translated.every(node => node.props.style.transform === 'translateX(-80.5px)'));
	state.props.optimizeHorizontalMovement = false;
	await nextTick();
	assert.ok(translated.every(node => node.props.style.willChange === 'auto'));
	for (const name of components) assert.equal(updates.get(name) ?? 0, 0, name);
	state.props.tlRangeX = 250;
	await nextTick();
	for (const name of components) assert.ok(updates.get(name) > 0, name);
});

// 【縦仮想一覧の境界でレイヤーが入れ替わっても、残った行を横移動で再描画しない】
// 斜めのパンを想定し、共通のキーを持つ行の再利用と、新しい行だけの初期描画を分ける。
test('keeps retained row contents stable during diagonal panning and row replacement', async t => {
	const state = await fixture(t);
	state.visible.value = [0, 1];
	await nextTick();
	updates.clear(); mounts.clear();
	state.visible.value = [1, 2];
	state.props.tlPosX = 100;
	await nextTick();
	for (const name of components) assert.equal(updates.get(name) ?? 0, 0, name);
	assert.equal(mounts.get('GsTimeline.Layer.Clips.vue'), 1);
	assert.equal(mounts.get('GsTimeline.Clip.vue'), 3);
	assert.equal(mounts.get('GsTimeline.Layer.Keyframes.vue'), 1);
});

// 【選択・クリップ編集・再生位置の変更では必要な子を更新し、素材背景も同じ座標で配置する】
// スクロールの最適化によって通常の編集が止まったり、トリム前の範囲だけ取り残されてはならない。
test('updates selection, clip timing and playback while positioning source ghosts with clips', async t => {
	const state = await fixture(t);
	state.props.selectedClipIds = ['clip-0'];
	await nextTick();
	assert.equal(updates.get('GsTimeline.Clip.vue'), 1);
	const ghost = descendants(state.root).find(node => node.props.class === 'sourceGhost');
	assert.deepEqual(ghost.props.style, { left: '140px', width: '2000px' });
	const clip = descendants(state.root).find(node => node.props['data-timeline-clip-id'] === 'clip-0');
	assert.equal(clip.props.style.left, '200px');
	state.layers[0].clips[0].startMs = 120;
	await nextTick();
	assert.equal(clip.props.style.left, '240px');
	assert.equal(ghost.props.style.left, '180px');
	state.props.sceneTimeMs = 150;
	await nextTick();
	assert.ok(clip.props.class.includes('active'));
	state.props.selectedKeyframes = [{ layerId: 'a', target: 'audio', paramPath: ['volume'], keyframeId: 'key-0' }];
	await nextTick();
	assert.ok(updates.get('GsTimeline.Layer.Keyframes.vue') > 0);
});

// 【追加・トリム・移動は非移動の表示領域と元のIDで扱う】
// 親要素をtransformすると、移動済みの矩形から時刻を求めてスクロール量を二重適用しやすい。
// 背景クリックはviewportで変換し、クリップとキーのイベントは所属先を保持する。
test('converts background gestures at the viewport and preserves clip and key events', async t => {
	const state = await fixture(t);
	state.props.tlPosX = 40;
	await nextTick();
	const nodes = descendants(state.root);
	const event = currentTarget => ({ button: 0, clientX: 250, currentTarget, stopPropagation() {}, preventDefault() {} });
	const backgrounds = nodes.filter(node => node.props.class === 'tl' && node.props.onDblclick);
	assert.equal(backgrounds.length, 2);
	backgrounds[0].props.onDblclick(event(backgrounds[0]));
	assert.deepEqual(state.events.at(-1), ['addClip', 115]);
	backgrounds[1].props.onDblclick(event(backgrounds[1]));
	const edit = commits.at(-1);
	assert.equal(edit[0], 'editTimelineLayerParam');
	assert.ok(edit[1].edit.value.keyframesTimeline.keyframes.some(point => point.x === 115));
	const clip = nodes.find(node => node.props['data-timeline-clip-id'] === 'clip-0');
	clip.props.onPointerdown(event(clip));
	assert.deepEqual(state.events.at(-1), ['move', { layerId: 'a', clipId: 'clip-0' }]);
	const trim = clip.children.find(node => node.props.class?.includes('trimStart'));
	trim.props.onPointerdown(event(trim));
	assert.deepEqual(state.events.at(-1), ['trim', { layerId: 'a', clipId: 'clip-0' }, 'start']);
	const key = nodes.find(node => node.props['data-timeline-keyframe-id'] === 'key-0');
	key.props.onPointerdown(event(key));
	assert.deepEqual(state.events.at(-1), ['keyMove', { layerId: 'a', target: 'audio', paramPath: ['volume'], keyframeId: 'key-0' }]);
});

// 【ローカル目盛りは長い交差クリップを含め、表示とスナップで同じ結果を使う】
// 表示外のクリップの目盛り生成を省略しても、端の補助目盛りや小数オフセットを失わない。
test('filters local rulers to intersecting clips without changing their tick positions', () => {
	const clips = [{ startMs: 0, durationMs: 10, contentOffsetMs: 0 }, { startMs: 0, durationMs: 10000, contentOffsetMs: 0.25 }, { startMs: 450, durationMs: 80, contentOffsetMs: 5.5 }, { startMs: 2000, durationMs: 10, contentOffsetMs: 0 }];
	for (const mode of ['legacy', 'binary', 'decimal125']) {
		const args = [400, 600, 6, mode, { halves: true, thirds: true }];
		const visible = getTimelineVisibleClipTicks(clips, ...args);
		assert.deepEqual(visible.map(entry => entry.clip), [clips[1], clips[2]]);
		assert.deepEqual(visible.flatMap(entry => [...entry.ticks.major, ...entry.ticks.minor]), clips.flatMap(clip => {
			const ticks = getTimelineClipTicks(clip, ...args);
			return [...ticks.major, ...ticks.minor];
		}));
	}
	assert.equal(timelineTimeToX(300, 100, 500, 1000), 400);
	assert.equal(timelineKeyframePosition(100.25, 2), 201);
});
