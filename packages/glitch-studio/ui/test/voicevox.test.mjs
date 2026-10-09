import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, isVariableStatement, ScriptTarget } from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: root,
	stdin: { resolveDir: root, loader: 'ts', contents: `
		export * from './src/audio/voicevox-generation.ts';
		export * from './src/audio/generated-speech-cache.ts';
		export * from './src/utility/voicevox-timeline-layer.ts';
		export { createTextTimelineLayer } from './src/utility/text-timeline-layer.ts';
		export { resolveLayerParameter, getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { validateVoicevoxSubtitle } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle-validation.ts';
		export * from './src/utility/timeline-keyframe-lanes.ts';
		export * from './src/utility/voicevox-utterance-edit.ts';
		export * from './src/utility/timeline-keyframe-clipboard.ts';
		export * from './src/utility/timeline-selection.ts';
		export * from './src/utility/timeline-marquee.ts';
		export * from './src/utility/timeline-snapping.ts';
		export * from './src/utility/timeline-ticks.ts';
		export * from './src/utility/timeline-keyframe-stretch.ts';
		export { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
		export { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
		export * from './src/gsproj.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { TimelineAudioExport } from './src/export/timeline-audio-export.ts';
		export * from './src/export/audio-export-settings.ts';
		export * from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
		export * from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-placement.ts';
		export * from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle-timing.ts';
		export * from '@gs/subsystems_timeline_shared/voicevox-requests.ts';
		export { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
		export { TimelineAudioRenderer } from '@gs/subsystems_timeline_audio-renderer/timeline-audio-renderer.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'],
	plugins: [{ name: 'voicevox-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path, namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: path.includes('effect-definitions') ? 'export const effectDefinitions = {};' : 'export const preferences = { s: { forceTypeSafety: true } };' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createVoicevoxTimelineLayer, getVoicevoxRequest, getVoicevoxRequestKey, createSpeechResolver, getVoicevoxSubtitle,
	getSceneAudioClips, TimelineAudioRenderer, VoicevoxGeneration, GeneratedSpeechCache, getVoicevoxRequests, getRequiredVoicevoxRequests,
	COMMAND_DEFS, UndoRedo, encodeProjectFile, decodeProjectFile, TimelineAudioExport, getExportAudioClips,
	createTextTimelineLayer, resolveLayerParameter, getLayerKeyframeParameters, validateVoicevoxSubtitle } = module.exports;
const { getTimelineKeyframeLanes, getTimelineKeyframeEntries, insertVoicevoxUtterance, getVoicevoxUtteranceTimeBounds,
	copyTimelineKeyframes, prepareTimelineKeyframePaste, getPastedTimelineKeySelection,
	constrainTimelineMove, keyframeMoveBounds, collectTimelineMarqueeCandidates, timelineLaneKey } = module.exports;

// Vueの実ハンドラーを実行し、DOM・描画機器を起動せず選択とScene時刻の結び付きを確認する。
async function loadHandler(name, context, component = 'GsTimeline.vue') {
	const source = await readFile(new URL(`../src/components/${component}`, import.meta.url), 'utf8');
	const script = parse(source).descriptor.scriptSetup.content;
	const ast = createSourceFile(component, script, ScriptTarget.Latest);
	const handler = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === name);
	assert.ok(handler);
	const { code } = await transform(handler.getText(ast), { loader: 'ts' });
	return new Function('context', `const { ${Object.keys(context).join(', ')} } = context; ${code}; return ${name};`)(context);
}
async function loadComputed(name, context, component) {
	const source = await readFile(new URL(`../src/components/${component}`, import.meta.url), 'utf8');
	const ast = createSourceFile(component, parse(source).descriptor.scriptSetup.content, ScriptTarget.Latest);
	const declaration = ast.statements.filter(isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
		.find(declaration => declaration.name.getText(ast) === name);
	assert.ok(declaration);
	const { code } = await transform(`const ${declaration.getText(ast)};`, { loader: 'ts' });
	return new Function('context', `const { ${Object.keys(context).join(', ')} } = context; ${code}; return ${name};`)(context);
}

const literal = value => ({ inputSource: 'literal', value });
const utterance = (id, timeMs, text = 'Hello', reading = null, styleId = 1) => ({ id, timeMs, text, reading, styleId, subtitleDuration: { mode: 'fill' } });
const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });
function fixture() {
	const layer = createVoicevoxTimelineLayer(0);
	layer.id = 'speech';
	layer.clips = [{ id: 'visible', startMs: 200, durationMs: 500, contentOffsetMs: 987.5 }];
	layer.utterances = [utterance('a', 100), utterance('b', 400), utterance('clear', 600, '')];
	const request = getVoicevoxRequest(layer.voicevox, layer.utterances[0]);
	const speech = { key: getVoicevoxRequestKey(request), sourceId: 'generated', durationMs: 1000,
		fileData: new Blob([Uint8Array.of(1, 2, 3)], { type: 'audio/wav' }), audioQuery: { speedScale: 1 }, engineVersion: 'test' };
	return { layer, scenes: [scene('root', [layer])], request, speech };
}

function editFixture(t) {
	t.mock.method(console, 'log', () => {});
	const f = fixture();
	const state = { timelineScenes: { value: f.scenes }, assets: { value: [] }, visualModules: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	return { ...f, state, history, point: id => ({ layerId: 'speech', target: 'utterance', paramPath: ['utterances'], keyframeId: id }) };
}

// 【発話と字幕装飾のキーを同じ範囲選択と前後移動で扱う】
// 発話だけのレイヤーにもレーンを公開し、クリップ外の発話へ移動して個別編集できるようにする。
test('includes utterances in marquee selection and selects speech when seeking to a key', async t => {
	const f = editFixture(t);
	const lanes = getTimelineKeyframeLanes(f.state, f.layer);
	assert.deepEqual(lanes[0].keyframes.map(key => key.x), [100, 400, 600]);
	const selection = collectTimelineMarqueeCandidates([{ id: 'speech', clips: f.layer.clips, lanes }],
		{ layerId: 'speech', offsetY: 24 }, { layerId: 'speech', offsetY: 56 },
		new Map([['speech', { clipLane: { top: 0, bottom: 23 }, keyframeLanes: new Map([[timelineLaneKey('utterance', ['utterances']), 40]]) }]]),
		{ left: 50, right: 500, position: 0, range: 1000, width: 1000 });
	assert.deepEqual(selection.clips, []);
	assert.deepEqual(selection.keyframes, [f.point('a'), f.point('b')]);
	const selected = { value: { kind: 'layers', ids: ['speech'] } };
	const position = { value: 0 };
	let sought;
	const seek = await loadHandler('seekToKeyframe', {
		selectedLayer: { value: f.layer }, keyframeEntries: { value: getTimelineKeyframeEntries(f.state, f.scenes[0].layers) },
		selection: selected, revealDetails() {}, previewPlayback: { seekTimeline(time) { sought = time; } }, tlPosX: position, tlRangeX: { value: 500 },
	});
	seek(100);
	assert.equal(sought, 100);
	assert.deepEqual(selected.value, { kind: 'keyframes', keyframes: [f.point('a')] });
	assert.equal(position.value, -150);
});

// 【複数発話を間隔を保ってスナップ移動し、隣接発話との衝突を避ける】
// 通常キーと同じドラッグ処理を通し、一連の移動が一回のUndoになり、最小時刻も負にならない。
test('snaps multiple utterances through the timeline drag handler and merges their history', async t => {
	const f = editFixture(t);
	const selection = { value: { kind: 'keyframes', keyframes: [f.point('a'), f.point('b')] } };
	const entries = { get value() { return getTimelineKeyframeEntries(f.state, f.scenes[0].layers); } };
	let move;
	const handler = await loadHandler('onKeyframeMoveStart', {
		...module.exports, selection, selectedTimelineKeyframes: { get value() { return selection.value.keyframes; } }, keyframeEntries: entries,
		stopSelectionDrag: undefined, tlElWidth: { value: 1000 }, tlRangeX: { value: 1000 }, tlPosX: { value: 0 },
		tlEl: { value: { focus() {} } }, sceneLayers: { value: f.scenes[0].layers }, stateManager: f.history,
		props: { sceneId: 'root' }, time: { value: 550 }, xTicksWithMinor: { value: [] },
		snapSettings: { value: { enabled: true, globalTicks: false, localTicks: false, seekBar: true } },
		xTicksCount: { value: 10 }, tickMode: { value: 'time' }, tickSubdivisions: { value: 1 },
		revealDetails() {}, onKeyframeSelected() { assert.fail('Existing multiple selection must be preserved'); },
		startSelectionMove(event, points, times, apply) { move = { points, times, apply }; },
	});
	handler({ button: 0, isPrimary: true, shiftKey: false, ctrlKey: false, metaKey: false }, f.point('a'));
	assert.equal(move.points.length, 2);
	assert.equal(move.points[1].maxDelta, 199);
	const snapped = constrainTimelineMove(148, move.points, move.times, 1);
	assert.equal(snapped.delta, 150);
	assert.equal(snapped.snappingTime, 550);
	move.apply(snapped.delta, 'drag');
	move.apply(160, 'drag');
	assert.deepEqual(f.layer.utterances.map(utterance => utterance.timeMs), [260, 560, 600]);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual(f.layer.utterances.map(utterance => utterance.timeMs), [100, 400, 600]);
	f.history.redo();
	assert.deepEqual(f.layer.utterances.map(utterance => utterance.timeMs), [260, 560, 600]);
	assert.equal(constrainTimelineMove(-1000, move.points, [], 1).delta, -100);
	handler({ button: 0, isPrimary: true, ctrlKey: true, preventDefault() {} }, f.point('b'));
	assert.deepEqual(selection.value.keyframes, [f.point('a')]);
	handler({ button: 0, isPrimary: true, metaKey: true, preventDefault() {} }, f.point('clear'));
	assert.deepEqual(selection.value.keyframes, [f.point('a'), f.point('clear')]);
});

// 【ダブルクリックの時刻で追加し、同時刻に既存キーがあればそれを編集する】
// 横スクロールと倍率を反映し、二重作成や本文の上書きをせず追加直後のキーを選択する。
test('adds and selects a speech key using the double-click handler', async t => {
	const f = editFixture(t);
	f.layer.utterances[1].styleId = 7;
	let selected;
	const add = await loadHandler('add', { insertVoicevoxUtterance, stateManager: f.history,
		props: { layer: f.layer, sceneId: 'root', offsetMs: 100, pixelsPerMs: 2 }, emit(event, id) { assert.equal(event, 'selected'); selected = id; } }, 'GsTimeline.VoicevoxKeys.vue');
	add({ button: 0, clientX: 620, currentTarget: { getBoundingClientRect: () => ({ left: 20 }) } });
	assert.equal(selected, 'b');
	assert.equal(f.history.undoStack.value.length, 0);
	add({ button: 0, clientX: 721, currentTarget: { getBoundingClientRect: () => ({ left: 20 }) } });
	assert.deepEqual(f.layer.utterances.find(utterance => utterance.id === selected), { id: selected, timeMs: 451, text: '', reading: null, styleId: 7, subtitleDuration: { mode: 'fill' } });
	assert.deepEqual(getVoicevoxUtteranceTimeBounds(f.layer.utterances, selected), { min: 401, max: 599 });
	f.history.undo();
	assert.equal(f.layer.utterances.some(utterance => utterance.id === selected), false);
	f.history.redo();
	assert.equal(f.layer.utterances.find(utterance => utterance.id === selected).styleId, 7);
});

// 【新しい発話は追加地点の直前の声を引き継ぎ、先頭と空レイヤーにも対応する】
// 配列順や将来のキーまでの距離で声が変わらず、空文字の終了キーにも設定を保持する。
// 追加時に値を確定するため、その後に継承元を変更しても追加済みの声は変わらない。
test('inherits the preceding voice by scene time with first-key and empty-layer defaults', () => {
	const keys = [utterance('later', 900, 'Later', null, 9), utterance('first', 100, 'First', null, 3), utterance('clear', 500, '', null, 7)];
	const before = structuredClone(keys);
	for (const [time, expectedStyle] of [[0, 3], [499, 3], [501, 7], [899, 7], [1000, 9]]) {
		const result = insertVoicevoxUtterance(keys, time);
		assert.equal(result.utterance.timeMs, time);
		assert.equal(result.utterance.styleId, expectedStyle);
		assert.equal(result.utterance.text, '');
		assert.equal(result.utterance.reading, null);
		assert.equal(result.utterances.length, 4);
	}
	const sameTime = insertVoicevoxUtterance(keys, 499.6);
	assert.equal(sameTime.utterance, keys[2]);
	assert.equal(sameTime.utterances, keys);
	assert.deepEqual(keys, before);
	const added = insertVoicevoxUtterance(keys, 300).utterance;
	keys[1].styleId = 11;
	assert.equal(added.styleId, 3);
	assert.equal(insertVoicevoxUtterance([], 200).utterance.styleId, 1);
	assert.equal(insertVoicevoxUtterance(keys, Infinity), null);
});

// 【シーク位置への追加とコピーで、それぞれ継承元とコピー元の声・字幕長を保持する】
// ボタン追加はFillで作成し、コピー＆ペーストでは配置先の声や字幕長に書き換えない。
test('inherits voice for new keys and preserves voice and subtitle duration when copying', async t => {
	const f = editFixture(t);
	f.layer.utterances[0].styleId = 3;
	f.layer.utterances[1].styleId = 7;
	f.layer.utterances[0].subtitleDuration = { mode: 'specified', durationMs: 250 };
	let selected;
	const context = {
		props: { layer: f.layer, sceneId: 'root', get utterance() { return f.layer.utterances[0]; } },
		error: { value: '' }, stateManager: f.history, insertVoicevoxUtterance,
		appContext: { previewPlayback: { currentTimelineTime: { value: 450 } } },
		emit(event, id) { assert.equal(event, 'selected'); selected = id; },
	};
	const commitLayer = await loadHandler('commit', context, 'GsTimeline.VoicevoxSettings.vue');
	const add = await loadHandler('add', { ...context, commit: commitLayer }, 'GsTimeline.VoicevoxSettings.vue');
	add();
	assert.equal(f.layer.utterances.find(utterance => utterance.id === selected).styleId, 7);
	assert.deepEqual(f.layer.utterances.find(utterance => utterance.id === selected).subtitleDuration, { mode: 'fill' });
	f.history.undo();
	const clipboard = copyTimelineKeyframes(f.state, f.scenes[0], [f.point('a')]);
	const pasted = prepareTimelineKeyframePaste(f.state, f.scenes[0], clipboard, 450);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'root', keyframes: pasted });
	assert.deepEqual(f.layer.utterances.at(-1), { ...f.layer.utterances[0], id: pasted[0].utterance.id, timeMs: 450 });
	f.history.undo();
	assert.equal(f.layer.utterances.length, 3);
	f.history.redo();
	assert.equal(f.layer.utterances.at(-1).styleId, 3);
	assert.deepEqual(f.layer.utterances.at(-1).subtitleDuration, { mode: 'specified', durationMs: 250 });
});

// 【単独選択した発話の声・本文・読み・時刻だけを編集する】
// 個別編集欄の値が別の発話へ波及せず、時刻の数値入力も隣の発話を追い越さないことを保証する。
test('edits only the selected utterance and clamps its time between neighbours', async t => {
	const f = editFixture(t);
	const props = { layer: f.layer, sceneId: 'root', get utterance() { return f.layer.utterances.find(utterance => utterance.id === 'b'); } };
	const error = { value: '' };
	const component = 'GsTimeline.VoicevoxUtteranceSettings.vue';
	const commit = await loadHandler('commit', { props, error, stateManager: f.history }, component);
	const edit = await loadHandler('edit', { props, commit }, component);
	const bounds = { get value() { return getVoicevoxUtteranceTimeBounds(f.layer.utterances, 'b'); } };
	const editTime = await loadHandler('editTime', { bounds, edit }, component);
	edit({ styleId: 7 });
	assert.equal(props.utterance.styleId, 7);
	assert.equal(f.layer.utterances[0].styleId, 1);
	assert.equal(f.layer.utterances[2].styleId, 1);
	assert.deepEqual(f.layer.voicevox, { speedScale: 1 });
	for (const styleId of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
		edit({ styleId });
		assert.match(error.value, /Invalid VOICEVOX utterance style/);
		assert.equal(props.utterance.styleId, 7);
		assert.equal(f.history.undoStack.value.length, 1);
	}
	edit({ text: 'New subtitle', reading: 'ニューサブタイトル' });
	assert.equal(f.layer.utterances[0].text, 'Hello');
	assert.equal(props.utterance.text, 'New subtitle');
	editTime(999);
	assert.equal(props.utterance.timeMs, 599);
	editTime(-10);
	assert.equal(props.utterance.timeMs, 101);
	f.history.undo();
	assert.equal(props.utterance.timeMs, 599);
	f.history.undo();
	f.history.undo();
	assert.equal(props.utterance.styleId, 7);
	f.history.undo();
	assert.deepEqual(props.utterance, utterance('b', 400));
	f.history.redo();
	assert.equal(props.utterance.styleId, 7);
	assert.equal(error.value, '');
});

// 【発話と通常キーを混在させても移動・貼付けの失敗を一部反映しない】
// 発話の同時刻禁止を操作境界で守り、コピー時の本文・読みとID再発行、混在削除のUndoを保証する。
test('keeps mixed key moves and pastes atomic and restores mixed deletions', t => {
	const f = editFixture(t);
	f.history.commit('editTimelineLayerParam', { sceneId: 'root', layerId: 'speech', target: 'voicevoxSubtitle', paramPath: ['size'], edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
	const binding = f.layer.subtitleParamValues.size;
	binding.keyframesTimeline.keyframes = [{ id: 'style', x: 120, value: 0.2, interpolation: { type: 'linear' } }];
	const style = { layerId: 'speech', target: 'voicevoxSubtitle', paramPath: ['size'], keyframeId: 'style' };
	assert.throws(() => f.history.commit('moveTimelineKeyframes', { sceneId: 'root', positions: [{ ...style, x: 200 }, { ...f.point('a'), x: 400 }] }), /Invalid VOICEVOX utterance/);
	assert.equal(binding.keyframesTimeline.keyframes[0].x, 120);
	assert.equal(f.layer.utterances[0].timeMs, 100);
	f.layer.utterances[0].reading = '読み';
	f.layer.utterances[0].styleId = 7;
	const clipboard = copyTimelineKeyframes(f.state, f.scenes[0], [f.point('a'), style]);
	f.layer.utterances[0].text = 'Changed after copy';
	f.layer.utterances[0].styleId = 9;
	assert.equal(prepareTimelineKeyframePaste(f.state, f.scenes[0], clipboard, 400), null);
	const paste = prepareTimelineKeyframePaste(f.state, f.scenes[0], clipboard, 800);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'root', keyframes: paste });
	assert.equal(f.layer.utterances.at(-1).text, 'Hello');
	assert.equal(f.layer.utterances.at(-1).reading, '読み');
	assert.equal(f.layer.utterances.at(-1).styleId, 7);
	assert.equal(f.layer.utterances.at(-1).timeMs, 800);
	assert.notEqual(f.layer.utterances.at(-1).id, 'a');
	f.history.undo(); assert.equal(f.layer.utterances.length, 3);
	f.history.redo(); assert.equal(f.layer.utterances.length, 4);
	f.history.commit('removeTimelineKeyframes', { sceneId: 'root', keyframes: paste.map(getPastedTimelineKeySelection) });
	assert.equal(f.scenes[0].layers[0].utterances.length, 3);
	assert.equal(f.scenes[0].layers[0].subtitleParamValues.size.keyframesTimeline.keyframes.length, 1);
	f.history.undo();
	assert.equal(f.scenes[0].layers[0].utterances.length, 4);
	assert.equal(f.scenes[0].layers[0].subtitleParamValues.size.keyframesTimeline.keyframes.length, 2);
});

// 【VOICEVOX字幕の定義・保存先・キー編集をTextレイヤーから独立させる】
// 同名の装飾でも専用の対象へ保存し、Text用の編集経路や本文Bindingを受け入れない。
// 字幕キーのUndo/Redoと既定値へのリセットも、独立した定義を通ることを確認する。
test('edits subtitle parameters independently from text layers', t => {
	t.mock.method(console, 'log', () => {});
	const f = fixture();
	const text = createTextTimelineLayer(0);
	f.scenes[0].layers.push(text);
	const state = { timelineScenes: { value: f.scenes }, assets: { value: [] }, visualModules: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	assert.equal('textParamValues' in f.layer, false);
	assert.equal('text' in f.layer.subtitleParamValues, false);
	assert.notEqual(resolveLayerParameter(state, f.layer, 'voicevoxSubtitle', ['size']).def, resolveLayerParameter(state, text, 'text', ['size']).def);
	assert.throws(() => resolveLayerParameter(state, f.layer, 'text', ['size']), /Invalid layer parameter target/);
	assert.throws(() => resolveLayerParameter(state, text, 'voicevoxSubtitle', ['size']), /Invalid layer parameter target/);
	assert.throws(() => validateVoicevoxSubtitle({ ...f.layer.subtitleParamValues, text: literal('Invalid') }), /Unknown VOICEVOX subtitle parameter/);
	const target = { sceneId: 'root', layerId: f.layer.id, target: 'voicevoxSubtitle', paramPath: ['size'] };
	history.commit('editTimelineLayerParam', { ...target, edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
	assert.equal(getLayerKeyframeParameters(state, f.layer)[0].target, 'voicevoxSubtitle');
	assert.equal(text.textParamValues.size.inputSource, 'literal');
	history.undo();
	assert.equal(f.layer.subtitleParamValues.size.inputSource, 'literal');
	history.redo();
	assert.equal(f.layer.subtitleParamValues.size.inputSource, 'keyframesTimelineInline');
	history.commit('editTimelineLayerParam', { ...target, edit: { kind: 'reset' } });
	assert.deepEqual(f.layer.subtitleParamValues.size, literal(0.1));
});

// 【キーを通過した履歴によらず、Scene時刻から発話の途中を読み出す】
// 同じ本文の繰り返し・左トリム・空文字キーの打切りを同時に確認する。
// contentOffsetMsを発話に加えると字幕と音声がずれるため、無関係な値も与える。
test('plans repeated speech and samples trimmed utterances at absolute scene time', async () => {
	const f = fixture();
	const plan = getSceneAudioClips(f.scenes, 'root', { type: 'all' }, createSpeechResolver([f.speech]));
	assert.deepEqual(plan.map(clip => [clip.sourceStartMs, clip.startMs, clip.endMs]), [[100, 200, 400], [400, 400, 600]]);
	assert.deepEqual(getSceneAudioClips(f.scenes, 'root'), []);
	const reads = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { reads.push(args); return [new Float32Array(args[2]).fill(1), new Float32Array(args[2]).fill(1)]; });
	const pcm = await renderer.renderClips(plan, 250, 400, 1000);
	assert.deepEqual(reads.map(args => args.slice(0, 4)), [['generated', 0.15, 150, 1000], ['generated', 0, 200, 1000]]);
	assert.equal(pcm[0][349], 1);
	assert.equal(pcm[0][350], 0);
	assert.equal(getVoicevoxSubtitle(f.layer.voicevox, f.layer.utterances, 99), '');
	assert.equal(getVoicevoxSubtitle(f.layer.voicevox, f.layer.utterances, 100), 'Hello');
	assert.equal(getVoicevoxSubtitle(f.layer.voicevox, f.layer.utterances, 600), '');
});

// 【字幕区間の編集は設定画面でだけFillと指定を切り替えられる】
// 詳細で長さを確定してからドラッグする仕様を守り、数値編集でもFillを暗黙に切り替えない。
// 生成済みなら発話長を初期値にし、再生成でユーザーの指定長が変わらないことも確認する。
test('changes subtitle duration mode only through utterance settings and keeps synthesis requests unchanged', async t => {
	const f = editFixture(t);
	const component = 'GsTimeline.VoicevoxUtteranceSettings.vue';
	const props = { layer: f.layer, get utterance() { return f.layer.utterances[0]; } };
	const edit = patch => f.history.commit('editVoicevoxLayer', { sceneId: 'root', layerId: 'speech', voicevox: f.layer.voicevox,
		utterances: f.layer.utterances.map(key => key.id === 'a' ? { ...key, ...patch } : key) });
	const state = { generatedSpeech: { value: [] } };
	const context = { ...module.exports, props, edit, stateManager: { state }, key: { value: getVoicevoxRequestKey(f.request) } };
	const mode = await loadHandler('changeSubtitleDurationMode', context, component);
	const duration = await loadHandler('editSubtitleDuration', context, component);
	duration(100);
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'fill' });
	assert.equal(f.history.undoStack.value.length, 0);
	mode('specified');
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 300 });
	duration(120.4);
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 120 });
	assert.equal(getVoicevoxSubtitle(f.layer.voicevox, f.layer.utterances, 219), 'Hello');
	assert.equal(getVoicevoxSubtitle(f.layer.voicevox, f.layer.utterances, 220), '');
	assert.deepEqual(getVoicevoxRequest(f.layer.voicevox, props.utterance), f.request);
	duration(0);
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 0 });
	mode('fill');
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'fill' });
	f.history.undo();
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 0 });
	f.history.redo();
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'fill' });
	// 明示指定へ切り替える時だけ、現在の発話に一致する生成音声の長さを採用する。
	state.generatedSpeech.value = [{ ...f.speech, durationMs: 133.5 }];
	mode('specified');
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 134 });
	state.generatedSpeech.value = [{ ...f.speech, durationMs: 250 }];
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 134 });
	mode('specified');
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 134 });
	f.history.undo();
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'fill' });
	f.history.redo();
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'specified', durationMs: 134 });
});

// 【発話長モードの延長は設定画面で編集し、音声更新・Undo・コピーでも維持する】
// 初期延長0で音声に合わせ、延長編集によって再合成やモードの暗黙変更を起こさない。
// 帯の表示も同じ規則に従い、更新された音声長と保存した延長量を組み合わせる。
test('edits speech duration extension with undo and preserves it when copying', async t => {
	const f = editFixture(t);
	const props = { layer: f.layer, sceneId: 'root', get utterance() { return f.layer.utterances[0]; } };
	const state = { generatedSpeech: { value: [] } };
	const edit = patch => f.history.commit('editVoicevoxLayer', { sceneId: 'root', layerId: 'speech', voicevox: f.layer.voicevox,
		utterances: f.layer.utterances.map(key => key.id === 'a' ? { ...key, ...patch } : key) });
	const context = { ...module.exports, props, edit, stateManager: { state }, key: { value: getVoicevoxRequestKey(f.request) } };
	const component = 'GsTimeline.VoicevoxUtteranceSettings.vue';
	const mode = await loadHandler('changeSubtitleDurationMode', context, component);
	const extension = await loadHandler('editSubtitleExtension', context, component);
	const duration = await loadHandler('editSubtitleDuration', context, component);
	const ranges = await loadComputed('subtitleRanges', { ...context, computed: getter => getter }, 'GsTimeline.VoicevoxKeys.vue');
	extension(50);
	assert.equal(f.history.undoStack.value.length, 0);
	mode('speech');
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'speech', extensionMs: 0 });
	assert.equal(ranges()[0].endMs, 400);
	state.generatedSpeech.value = [{ ...f.speech, durationMs: 125.5 }];
	assert.equal(ranges()[0].endMs, 225.5);
	assert.equal(ranges()[0].canResize, false);
	extension(50.4);
	duration(200);
	mode('speech');
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'speech', extensionMs: 50 });
	assert.equal(ranges()[0].endMs, 275.5);
	assert.deepEqual(getVoicevoxRequest(f.layer.voicevox, props.utterance), f.request);
	f.history.undo();
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'speech', extensionMs: 0 });
	f.history.redo();
	assert.deepEqual(props.utterance.subtitleDuration, { mode: 'speech', extensionMs: 50 });
	state.generatedSpeech.value = [{ ...f.speech, durationMs: 80.5 }];
	assert.equal(ranges()[0].endMs, 230.5);
	const clipboard = copyTimelineKeyframes(f.state, f.scenes[0], [f.point('a')]);
	const paste = prepareTimelineKeyframePaste(f.state, f.scenes[0], clipboard, 700);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'root', keyframes: paste });
	assert.deepEqual(f.layer.utterances.at(-1).subtitleDuration, { mode: 'speech', extensionMs: 50 });
	f.history.undo();
	assert.equal(f.layer.utterances.length, 3);
	f.history.redo();
	assert.deepEqual(f.layer.utterances.at(-1).subtitleDuration, { mode: 'speech', extensionMs: 50 });
});

// 【指定字幕の終端だけスナップ伸縮し、開始時刻や字幕長モードを変えない】
// 次のキー・クリップを越えて伸ばさず、開始時の長さから移動量を適用して一回のUndoにする。
test('snaps specified subtitle ends with one undo and refuses fill and speech modes or clipped ends', async t => {
	const f = editFixture(t);
	f.layer.utterances[0].subtitleDuration = { mode: 'specified', durationMs: 150 };
	const selection = { value: { kind: 'layers', ids: [] } };
	let move;
	let starts = 0;
	const handler = await loadHandler('onSubtitleTrimStart', {
		...module.exports, stopSelectionDrag: undefined, tlElWidth: { value: 1000 }, tlRangeX: { value: 1000 }, tlPosX: { value: 0 },
		sceneLayers: { value: f.scenes[0].layers }, stateManager: { state: { ...f.history.state, generatedSpeech: { value: [{ ...f.speech, durationMs: 220 }] } }, commit: f.history.commit.bind(f.history) },
		keyframeEntries: { get value() { return getTimelineKeyframeEntries(f.state, f.scenes[0].layers); } },
		props: { sceneId: 'root' }, time: { value: 550 }, xTicksWithMinor: { value: [] }, xTicksCount: { value: 10 },
		tickMode: { value: 'legacy' }, tickSubdivisions: { value: 1 },
		snapSettings: { value: { enabled: true, globalTicks: false, localTicks: false, seekBar: true } },
		onKeyframeSelected(point) { selection.value = { kind: 'keyframes', keyframes: [point] }; },
		startSelectionMove(_event, points, snapTimes, apply) { starts++; move = delta => apply(constrainTimelineMove(delta, points, snapTimes, 1).delta, 'subtitle-drag'); },
	});
	const event = { button: 0, isPrimary: true };
	handler(event, 'speech', 'a', 'visible');
	assert.deepEqual(selection.value.keyframes, [f.point('a')]);
	move(67); // 音声末尾320msへ吸着する。
	assert.deepEqual(f.layer.utterances[0].subtitleDuration, { mode: 'specified', durationMs: 220 });
	move(500);
	assert.deepEqual(f.layer.utterances[0].subtitleDuration, { mode: 'specified', durationMs: 300 });
	assert.equal(f.layer.utterances[0].timeMs, 100);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual(f.layer.utterances[0].subtitleDuration, { mode: 'specified', durationMs: 150 });
	f.history.redo();
	assert.deepEqual(f.layer.utterances[0].subtitleDuration, { mode: 'specified', durationMs: 300 });
	f.layer.utterances[0].subtitleDuration = { mode: 'fill' };
	assert.equal(move(-20), false);
	handler(event, 'speech', 'a', 'visible');
	assert.equal(starts, 1);
	f.layer.utterances[0].subtitleDuration = { mode: 'speech', extensionMs: 20 };
	assert.equal(move(-20), false);
	handler(event, 'speech', 'a', 'visible');
	assert.equal(starts, 1);
	f.layer.utterances[0].subtitleDuration = { mode: 'specified', durationMs: 500 };
	handler(event, 'speech', 'a', 'visible');
	assert.equal(starts, 1);
	f.layer.utterances[1].subtitleDuration = { mode: 'specified', durationMs: 100 };
	f.layer.clips[0].durationMs = 250;
	handler(event, 'speech', 'b', 'visible');
	assert.equal(starts, 1);
});

// 【字幕帯は未生成でも表示し、Fillとクリップによる切断箇所では伸縮させない】
// 生成音声の長さと字幕の長さを別々に示し、帯の区間をレンダラーの表示判定と一致させる。
test('shows subtitle ranges before synthesis and exposes resize handles only at specified ends', async () => {
	const f = fixture();
	f.layer.utterances[0].subtitleDuration = { mode: 'specified', durationMs: 250 };
	const state = { generatedSpeech: { value: [] } };
	const ranges = await loadComputed('subtitleRanges', { ...module.exports, computed: getter => getter, props: { layer: f.layer }, stateManager: { state } }, 'GsTimeline.VoicevoxKeys.vue');
	assert.deepEqual(ranges().map(range => [range.utteranceId, range.startMs, range.endMs, range.canResize]), [['a', 200, 350, true], ['b', 400, 600, false]]);
	f.layer.clips[0].durationMs = 120;
	assert.deepEqual(ranges().map(range => [range.startMs, range.endMs, range.canResize]), [[200, 320, false]]);
});

// 【発話レーンの音声区間表示を再生計画と一致させる】
// 次のキー・空文字キー・クリップ境界・音声末尾の規則をUI側へ複製せず、未生成では帯を表示しない。
test('displays the same prepared speech intervals as playback across separated clips', async () => {
	const f = fixture();
	f.layer.clips = [{ id: 'left', startMs: 200, durationMs: 100, contentOffsetMs: 90 }, { id: 'right', startMs: 350, durationMs: 500, contentOffsetMs: 0 }];
	const state = { generatedSpeech: { value: [] } };
	const ranges = await loadComputed('ranges', { ...module.exports, computed: getter => getter, props: { layer: f.layer }, stateManager: { state } }, 'GsTimeline.VoicevoxKeys.vue');
	assert.deepEqual(ranges(), []);
	for (const durationMs of [50, 175.5, 1000]) {
		state.generatedSpeech.value = [{ ...f.speech, durationMs }];
		const displayed = ranges().map(({ key, ...interval }) => interval);
		const playback = getSceneAudioClips(f.scenes, 'root', { type: 'all' }, createSpeechResolver(state.generatedSpeech.value)).map(({ gains, ...interval }) => interval);
		assert.deepEqual(displayed, playback);
	}
	assert.deepEqual(ranges().map(range => range.key), ['a:left', 'a:right', 'b:right']);
});

// 【クリップを音声に合わせる操作も次のキーと音声末尾で打ち切る】
// 現在のクリップ終端では切らずに延長でき、小数msの音声末尾を切り上げて保つ。
test('fits the last clip using shared speech intervals before clipping to its current end', async () => {
	const f = fixture();
	f.layer.utterances = [utterance('a', 100), utterance('clear', 400, ''), utterance('b', 650)];
	const error = { value: '' };
	let edit;
	const state = { generatedSpeech: { value: [{ ...f.speech, durationMs: 125.5 }] } };
	const fit = await loadHandler('fitLastClip', { ...module.exports, props: { layer: f.layer, sceneId: 'root' }, error,
		stateManager: { state, commit(_command, payload) { edit = payload; } } }, 'GsTimeline.VoicevoxSettings.vue');
	fit();
	assert.equal(error.value, '');
	assert.equal(edit.deltaMs, 76);
	state.generatedSpeech.value = [];
	fit();
	assert.match(error.value, /Generate the speech/);
});

// 【子Sceneのトリムと上下レイヤーの音声参照でも発話の原点を維持する】
// ネストした配置ごとに時刻が違っても同じ生成音声を共有でき、無効レイヤーは取得しない。
test('supports nested placements and audio layer selection without moving speech keys', () => {
	const f = fixture();
	const parent = { id: 'child', name: 'Child', layerType: 'scene', isDisabled: false, automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: literal(0.5) }, clips: [{ id: 'placement', sceneId: 'root', startMs: 1000, contentOffsetMs: 250, durationMs: 400 }] };
	const scenes = [...f.scenes, scene('parent', [parent])];
	const plan = getSceneAudioClips(scenes, 'parent', { type: 'layer', layerId: 'child' }, createSpeechResolver([f.speech]));
	assert.deepEqual(plan.map(clip => [clip.sourceStartMs, clip.startMs, clip.endMs]), [[850, 1000, 1150], [1150, 1150, 1350]]);
	assert.equal(plan[0].gains.length, 2);
	assert.equal(getSceneAudioClips(f.scenes, 'root', { type: 'layer', layerId: 'speech' }, createSpeechResolver([f.speech])).length, 2);
	f.layer.isDisabled = true;
	assert.deepEqual(getSceneAudioClips(scenes, 'parent', { type: 'all' }, createSpeechResolver([f.speech])), []);
});

// 【キーの編集と衝突拒否をCommandの原子性・Undo/Redoで保証する】
// 無効な同時刻キーの追加が一部反映されたり、クリップ移動でキーが追従したりしない。
test('edits speech through undoable commands and rejects duplicate times atomically', t => {
	t.mock.method(console, 'log', () => {});
	const f = fixture();
	const state = { timelineScenes: { value: f.scenes }, assets: { value: [] }, visualModules: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const payload = { sceneId: 'root', layerId: 'speech', voicevox: f.layer.voicevox, utterances: [utterance('new', 350, 'Edited')] };
	const before = structuredClone(f.layer.utterances);
	history.commit('editVoicevoxLayer', payload);
	assert.deepEqual(f.layer.utterances, payload.utterances);
	history.undo(); assert.deepEqual(f.layer.utterances, before);
	history.redo(); assert.deepEqual(f.layer.utterances, payload.utterances);
	assert.throws(() => history.commit('editVoicevoxLayer', { ...payload, utterances: [utterance('a', 350), utterance('b', 350)] }), /Invalid/);
	assert.deepEqual(f.layer.utterances, payload.utterances);
	history.commit('moveTimelineClips', { sceneId: 'root', clips: [{ layerId: 'speech', clipId: 'visible' }], deltaMs: 500 });
	assert.equal(f.layer.utterances[0].timeMs, 350);
});

// 【生成済みバイナリと読み・声設定をAssetなしで保存する】
// エンジンが利用できない環境でも同じ結果を再生するため、WAVと生成メタデータを往復する。
// 無効・クリップ外の現行発話は保存し、削除済み・旧本文・空文字キーの音声は残さない。
test('persists only currently referenced speech and keeps disabled and pending utterances', async () => {
	const f = fixture();
	f.layer.utterances[0].subtitleDuration = { mode: 'speech', extensionMs: 125 };
	f.layer.utterances.push(utterance('pending', 650, 'Not generated', '別の読み', 7));
	const dormant = createVoicevoxTimelineLayer(0);
	dormant.isDisabled = true;
	dormant.clips = [];
	dormant.utterances = [utterance('dormant', 5000, 'Dormant')];
	f.scenes[0].layers.push(dormant);
	const dormantSpeech = { ...f.speech, sourceId: 'dormant', key: getVoicevoxRequestKey(getVoicevoxRequest(dormant.voicevox, dormant.utterances[0])) };
	const obsoleteSpeech = { ...f.speech, sourceId: 'obsolete', key: getVoicevoxRequestKey({ ...f.request, text: 'Old text' }) };
	const clearSpeech = { ...f.speech, sourceId: 'clear', key: getVoicevoxRequestKey({ ...f.request, text: '' }) };
	const project = { id: 'p', gsVersion: '2.0.0-alpha.1', name: 'Speech', description: '', author: '', timelineFps: 60,
		timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, resolution: { width: 640, height: 480 },
		assets: [], players: [], visualModules: [], timelineScenes: f.scenes, generatedSpeech: [f.speech, dormantSpeech, obsoleteSpeech, clearSpeech] };
	const restored = decodeProjectFile(await encodeProjectFile(project));
	assert.deepEqual(restored.timelineScenes, f.scenes);
	assert.deepEqual(restored.assets, []);
	assert.deepEqual(restored.generatedSpeech.map(speech => speech.sourceId), ['generated', 'dormant']);
	assert.deepEqual(new Uint8Array(await restored.generatedSpeech[0].fileData.arrayBuffer()), Uint8Array.of(1, 2, 3));
	assert.deepEqual(restored.generatedSpeech[0].audioQuery, f.speech.audioQuery);
	assert.equal(getSceneAudioClips(restored.timelineScenes, 'root', { type: 'all' }, createSpeechResolver(restored.generatedSpeech)).length, 2);
});

// 【表示や配置だけを変えたときは音声を再合成しない】
// 読みを明示した発話は表示本文が異なっても共有し、声・話速の変更だけを別要求にする。
test('keys synthesis by reading and voice settings rather than placement or subtitles', () => {
	const settings = { speedScale: 1 };
	const first = getVoicevoxRequestKey(getVoicevoxRequest(settings, utterance('a', 0, 'WebGPU', 'ウェブジーピーユー')));
	assert.equal(first, getVoicevoxRequestKey(getVoicevoxRequest(settings, utterance('b', 1234, 'WEB GPU', 'ウェブジーピーユー'))));
	assert.notEqual(first, getVoicevoxRequestKey(getVoicevoxRequest({ ...settings, speedScale: 1.5 }, utterance('a', 0, 'WebGPU', 'ウェブジーピーユー'))));
	assert.notEqual(first, getVoicevoxRequestKey(getVoicevoxRequest(settings, utterance('a', 0, 'WebGPU', 'ウェブジーピーユー', 7))));
});

// 【同じレイヤーで同じ本文でも発話ごとの声で生成・再生・書き出し要求を分ける】
// 一つの発話の声を変えた際、隣の発話のキャッシュまで無効化したり旧音声を使わない。
test('resolves generation, playback and export per utterance voice', () => {
	const f = fixture();
	f.layer.utterances[1].styleId = 7;
	const requests = getVoicevoxRequests(f.scenes);
	assert.deepEqual(requests, [{ styleId: 1, speedScale: 1, text: 'Hello' }, { styleId: 7, speedScale: 1, text: 'Hello' }]);
	assert.deepEqual(getRequiredVoicevoxRequests(f.scenes, 'root', 200, 600), requests);
	assert.deepEqual(getRequiredVoicevoxRequests(f.scenes, 'root', 450, 550), [requests[1]]);
	const secondSpeech = { ...f.speech, key: getVoicevoxRequestKey(requests[1]), sourceId: 'second-voice' };
	const plan = getSceneAudioClips(f.scenes, 'root', { type: 'all' }, createSpeechResolver([f.speech, secondSpeech]));
	assert.deepEqual(plan.map(clip => [clip.sourceId, clip.startMs, clip.endMs]), [['generated', 200, 400], ['second-voice', 400, 600]]);
	f.layer.utterances[1].styleId = 9;
	const pendingPlan = getSceneAudioClips(f.scenes, 'root', { type: 'all' }, createSpeechResolver([f.speech, secondSpeech]));
	assert.deepEqual(pendingPlan.map(clip => clip.sourceId), ['generated']);
});

// 【重複生成をまとめ、プロジェクト変更前の応答を捨てる】
// HTTPの中断可否に依存せず、旧ファイルの音声が新しいプロジェクトへ保存されないことを保証する。
test('deduplicates synthesis and rejects responses from an old project', async () => {
	const f = fixture();
	let stored = [];
	let complete;
	let calls = 0;
	const generation = new VoicevoxGeneration({ getScenes: () => f.scenes, getSpeech: () => stored, setSpeech: value => { stored = value; },
		synthesize: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
	const first = generation.generate(f.request);
	assert.equal(generation.generate(f.request), first);
	await Promise.resolve(); assert.equal(calls, 1);
	generation.reset();
	complete(f.speech);
	await assert.rejects(first, /Project changed/);
	assert.deepEqual(stored, []);
	const next = generation.generate(f.request);
	await new Promise(resolve => setImmediate(resolve));
	complete(f.speech);
	await next;
	assert.equal(stored.length, 1);
	await generation.generate(f.request);
	assert.equal(calls, 2);
});

function queuedGenerationFixture(t, cacheLimits) {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture();
	f.layer.utterances = [utterance('first', 100, 'First')];
	let stored = [];
	const calls = [];
	const generation = new VoicevoxGeneration({
		cacheLimits,
		getScenes: () => f.scenes, getSpeech: () => stored, setSpeech: value => { stored = value; },
		synthesize: request => new Promise(resolve => { calls.push({ request, resolve }); }),
	});
	t.after(() => generation.reset());
	const flush = () => new Promise(resolve => setImmediate(resolve));
	return { ...f, generation, calls, get stored() { return stored; },
		async schedule() { generation.schedule(); t.mock.timers.tick(400); await flush(); },
		async complete(index) {
			const call = calls[index];
			call.resolve({ ...f.speech, key: getVoicevoxRequestKey(call.request), sourceId: call.request.text });
			await flush();
		},
		request: text => ({ styleId: 1, speedScale: 1, text }),
	};
}

// 【一時音声キャッシュを容量と件数で制限し、最近再利用した結果を残す】
// 長時間の編集で旧音声が増え続けないよう、WAVだけでなくAudioQueryも上限へ含める。
test('bounds temporary speech by bytes and entry count and evicts least recently used results', () => {
	const { speech } = fixture();
	const cache = new GeneratedSpeechCache({ maxBytes: 2048, maxEntries: 2 });
	cache.set({ ...speech, key: 'a' });
	cache.set({ ...speech, key: 'b' });
	assert.ok(cache.get('a'));
	cache.set({ ...speech, key: 'c' });
	assert.equal(cache.has('b'), false);
	assert.ok(cache.take('a'));
	assert.equal(cache.has('a'), false);
	cache.set({ ...speech, key: 'large', fileData: new Blob([new Uint8Array(1600)]) });
	assert.equal(cache.has('large'), true);
	cache.set({ ...speech, key: 'next', fileData: new Blob([new Uint8Array(1600)]) });
	assert.equal(cache.has('large'), false);
	assert.equal(cache.has('next'), true);
	cache.set({ ...speech, key: 'metadata', audioQuery: { text: '語'.repeat(2048) } });
	assert.equal(cache.has('metadata'), false);
	assert.equal(cache.has('next'), true);
	cache.clear();
	assert.equal(cache.has('next'), false);
});

// 【Undo用音声は保存状態から外し、容量制限後も現行音声を保持する】
// Undo先を取り出す前に現在の音声をキャッシュへ格納すると、最小容量では戻す音声を失う。
// 上限で失った過去本文へ戻した場合だけ再生成し、既存の生成キューを利用する。
test('restores cached speech before eviction and regenerates only evicted undo results', async t => {
	const f = queuedGenerationFixture(t, { maxEntries: 1 });
	await f.schedule();
	await f.complete(0);
	f.layer.utterances[0].text = 'Second';
	await f.schedule();
	assert.deepEqual(f.stored, []);
	await f.complete(1);
	f.layer.utterances[0].text = 'First';
	await f.schedule();
	assert.deepEqual(f.stored.map(speech => speech.sourceId), ['First']);
	assert.equal(f.calls.length, 2);
	f.layer.utterances[0].text = 'Third';
	await f.schedule();
	await f.complete(2);
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(f.request('Second'))], undefined);
	assert.deepEqual(f.stored.map(speech => speech.sourceId), ['Third']);
	f.layer.utterances[0].text = 'Second';
	await f.schedule();
	assert.deepEqual(f.calls.map(call => call.request.text), ['First', 'Second', 'Third', 'Second']);
	await f.complete(3);
	assert.deepEqual(f.stored.map(speech => speech.sourceId), ['Second']);
});

// 【一時音声はプロジェクトを切り替えたら破棄する】
// 再読み込み後にはUndo履歴がないため、前プロジェクトの旧本文を保持・再利用しない。
test('clears temporary speech when resetting the project', async t => {
	const f = queuedGenerationFixture(t);
	await f.schedule();
	await f.complete(0);
	f.layer.utterances[0].text = 'Edited';
	f.generation.synchronizeSpeech();
	assert.deepEqual(f.stored, []);
	f.generation.reset();
	f.layer.utterances[0].text = 'First';
	await f.schedule();
	assert.equal(f.calls.length, 2);
	await f.complete(1);
});

// 【書き出しが後で使う生成済み音声も準備開始時から保護する】
// 先頭の合成待ち中にレイヤーが消え、Undo用キャッシュへ一件も保存できなくても再生成しない。
// 書き出しには独立した結果一覧を返し、終了後は予約を解放する。
test('pins prepared export audio across editing and cache eviction until returning a snapshot', async t => {
	const f = queuedGenerationFixture(t, { maxBytes: 0 });
	await f.schedule();
	await f.complete(0);
	const preparation = f.generation.prepare([f.request('Waiting'), f.request('First')], new AbortController().signal);
	f.scenes[0].layers = [];
	await f.schedule();
	assert.deepEqual(f.stored, []);
	await f.complete(1);
	const prepared = await preparation;
	assert.deepEqual(prepared.map(speech => speech.sourceId), ['Waiting', 'First']);
	assert.deepEqual(f.calls.map(call => call.request.text), ['First', 'Waiting']);
	const next = f.generation.prepare([f.request('First')], new AbortController().signal);
	assert.equal(f.calls.length, 3);
	await f.complete(2);
	await next;
	assert.deepEqual(prepared.map(speech => speech.sourceId), ['Waiting', 'First']);
	assert.deepEqual(f.stored, []);
});

// 【同じ本文を再生成しても各書き出しは開始時の生成結果を維持する】
// 複数の書き出しで結果の保持先を共有すると、後の書き出しまで先の古い音声を使ってしまう。
test('keeps independent prepared results for overlapping export snapshots', async t => {
	const f = queuedGenerationFixture(t, { maxBytes: 0 });
	await f.schedule();
	await f.complete(0);
	const regeneration = f.generation.generate(f.request('First'), true);
	const requests = [f.request('Waiting'), f.request('First')];
	const firstExport = f.generation.prepare(requests, new AbortController().signal);
	f.calls[1].resolve({ ...f.speech, key: getVoicevoxRequestKey(f.request('First')), sourceId: 'regenerated' });
	await regeneration;
	const secondExport = f.generation.prepare(requests, new AbortController().signal);
	f.scenes[0].layers = [];
	f.generation.synchronizeSpeech();
	await f.complete(2);
	assert.deepEqual((await firstExport).map(speech => speech.sourceId), ['Waiting', 'First']);
	assert.deepEqual((await secondExport).map(speech => speech.sourceId), ['Waiting', 'regenerated']);
	assert.deepEqual(f.stored, []);
});

// 【自動生成の待機中に本文を再編集したら、途中の文章を合成せず最新を処理する】
// 実行中の合成は完了させて再利用可能にしつつ、未着手の古い要求で最新の発話を待たせない。
test('drops obsolete automatic requests and synthesizes the latest edit next', async t => {
	const f = queuedGenerationFixture(t);
	await f.schedule();
	for (const text of ['Intermediate 1', 'Intermediate 2', 'Latest']) {
		f.layer.utterances[0].text = text;
		await f.schedule();
	}
	assert.deepEqual(f.calls.map(call => call.request.text), ['First']);
	await f.complete(0);
	assert.deepEqual(f.calls.map(call => call.request.text), ['First', 'Latest']);
	for (const text of ['Intermediate 1', 'Intermediate 2']) assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(f.request(text))], undefined);
	await f.complete(1);
	assert.deepEqual(f.stored.map(speech => speech.sourceId), ['Latest']);
	f.layer.utterances[0].text = 'First';
	await f.schedule();
	assert.deepEqual(f.stored.map(speech => speech.sourceId), ['First']);
	assert.equal(f.calls.length, 2);
});

// 【キーやレイヤーの削除で不要になった未着手の自動生成を取り除く】
// 編集時の整理に加えて、実行直前にも現在の要求を確認し、変更通知前の古い要求も送信しない。
test('removes automatic work for deleted utterances and layers before synthesis starts', async t => {
	const f = queuedGenerationFixture(t);
	await f.schedule();
	f.layer.utterances.push(utterance('removed', 400, 'Removed key'));
	await f.schedule();
	f.layer.utterances.pop();
	f.generation.schedule();
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(f.request('Removed key'))], undefined);
	const removedLayer = createVoicevoxTimelineLayer(0);
	removedLayer.utterances = [utterance('removed', 100, 'Removed layer')];
	f.scenes[0].layers.push(removedLayer);
	await f.schedule();
	f.scenes[0].layers.pop();
	await f.complete(0);
	assert.deepEqual(f.calls.map(call => call.request.text), ['First']);
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(f.request('Removed layer'))], undefined);
});

// 【取消し済みの本文へ戻した場合は、同じ要求キーを再度生成待ちにできる】
// 古い要求の終了処理で新しい待機状態を消さず、Undoなどで戻した本文を一度だけ合成する。
test('can queue a cancelled automatic request again without keeping its stale status', async t => {
	const f = queuedGenerationFixture(t);
	await f.schedule();
	for (const text of ['Restored', 'Discarded', 'Restored']) {
		f.layer.utterances[0].text = text;
		await f.schedule();
	}
	await f.complete(0);
	assert.deepEqual(f.calls.map(call => call.request.text), ['First', 'Restored']);
	await f.complete(1);
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(f.request('Restored'))].state, 'ready');
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(f.request('Discarded'))], undefined);
});

// 【書き出しのスナップショットが必要とする全要求は、編集中の削除から保護する】
// prepareが先頭の発話を待っている間も後続を保持し、共有した自動生成をキャンセルしない。
test('retains every export snapshot request while removing unused automatic work', async t => {
	const f = queuedGenerationFixture(t);
	await f.schedule();
	f.layer.utterances.push(utterance('snapshot', 400, 'Snapshot'), utterance('unused', 600, 'Unused'));
	await f.schedule();
	const preparation = f.generation.prepare([f.request('First'), f.request('Snapshot')], new AbortController().signal);
	f.scenes[0].layers = [];
	await f.schedule();
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(f.request('Unused'))], undefined);
	await f.complete(0);
	assert.deepEqual(f.calls.map(call => call.request.text), ['First', 'Snapshot']);
	await f.complete(1);
	const prepared = await preparation;
	assert.deepEqual(prepared.map(speech => speech.sourceId), ['First', 'Snapshot']);
	assert.deepEqual(f.stored, []);
});

// 【書き出し待ちを共有しても最後の取消しだけで不要な待機要求を除去する】
// 別の書き出しや手動再生成の要求を巻き込まず、取消し後の未着手合成を残さない。
test('releases cancelled export requests without cancelling other exports or manual generation', async t => {
	const f = queuedGenerationFixture(t);
	await f.schedule();
	const request = f.request('Snapshot');
	const firstController = new AbortController();
	const secondController = new AbortController();
	const first = f.generation.prepare([request], firstController.signal);
	const second = f.generation.prepare([request], secondController.signal);
	firstController.abort(new Error('First cancelled'));
	await assert.rejects(first, /First cancelled/);
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(request)].state, 'generating');
	secondController.abort(new Error('Second cancelled'));
	await assert.rejects(second, /Second cancelled/);
	assert.equal(f.generation.statuses.value[getVoicevoxRequestKey(request)], undefined);
	const manual = f.generation.generate(f.request('Manual'), true);
	await f.schedule();
	await f.complete(0);
	assert.deepEqual(f.calls.map(call => call.request.text), ['First', 'Manual']);
	await f.complete(1);
	await manual;
});

// 【プロジェクト切替で旧待機要求を捨てても、新プロジェクトの同じ要求を保護する】
// 旧書き出しのfinallyが遅れて実行されても新しい予約を減らさず、実行中の旧結果も混入させない。
test('resets queued work without releasing new-project export reservations for the same key', async t => {
	const f = queuedGenerationFixture(t);
	await f.schedule();
	const request = f.request('Snapshot');
	const oldPreparation = f.generation.prepare([request], new AbortController().signal);
	const oldResult = assert.rejects(oldPreparation, /Project changed/);
	f.generation.reset();
	f.scenes[0].layers = [];
	const newPreparation = f.generation.prepare([request], new AbortController().signal);
	await oldResult;
	await f.schedule();
	await f.complete(0);
	assert.deepEqual(f.calls.map(call => call.request.text), ['First', 'Snapshot']);
	assert.deepEqual(f.stored, []);
	await f.complete(1);
	assert.deepEqual((await newPreparation).map(speech => speech.sourceId), ['Snapshot']);
	assert.deepEqual(f.stored, []);
});

// 【書き出しダイアログの音声有無は未生成でも表示し、生成済みの長さは反映する】
// 実行時の未生成検証をcomputedで呼ぶと、準備ボタンを押す前にダイアログが例外になる。
// 実際のcomputedの依存を渡して、静止画・範囲外・無効レイヤーも音声なしと判定する。
test('evaluates export dialog audio presence without requiring prepared speech', async () => {
	const f = fixture();
	const context = { ...module.exports, computed: getter => getter, scene: { value: f.scenes[0] }, sceneId: { value: 'root' },
		settings: { value: { format: 'mp4', positionMs: 250, endTimeMs: 300 } },
		stateManager: { state: { timelineScenes: { value: f.scenes }, generatedSpeech: { value: [] } } } };
	const includesAudio = await loadComputed('includesAudio', context, 'GsTimelineExportDialog.vue');
	assert.equal(includesAudio(), true);
	context.stateManager.state.generatedSpeech.value = [f.speech];
	assert.equal(includesAudio(), true);
	context.stateManager.state.generatedSpeech.value = [{ ...f.speech, durationMs: 50 }];
	assert.equal(includesAudio(), false);
	context.stateManager.state.generatedSpeech.value = [];
	f.layer.isDisabled = true;
	assert.equal(includesAudio(), false);
	f.layer.isDisabled = false;
	context.settings.value.positionMs = 701;
	context.settings.value.endTimeMs = 900;
	assert.equal(includesAudio(), false);
	context.settings.value = { format: 'webp', positionMs: 250 };
	assert.equal(includesAudio(), false);
	context.scene.value = undefined;
	assert.equal(includesAudio(), false);
});

// 【書き出しは有効範囲だけを準備し、生成失敗を無音として通さない】
// 範囲外・非表示の発話の失敗で書き出しを妨げず、必要な発話の失敗は呼び出し元へ伝える。
test('prepares required speech for export and propagates generation failures', async () => {
	const f = fixture();
	f.layer.utterances.push(utterance('outside', 800, 'Outside'));
	assert.deepEqual(getRequiredVoicevoxRequests(f.scenes, 'root', 250, 500), [f.request]);
	assert.deepEqual(getRequiredVoicevoxRequests(f.scenes, 'root', 701, 900), []);
	const generation = new VoicevoxGeneration({ getScenes: () => f.scenes, getSpeech: () => [], setSpeech: () => {}, synthesize: async () => { throw new Error('Engine unavailable'); } });
	await assert.rejects(generation.prepare([f.request], new AbortController().signal), /Engine unavailable/);
	assert.equal(generation.statuses.value[getVoicevoxRequestKey(f.request)].state, 'error');
	const settings = { format: 'mp4', positionMs: 250, endTimeMs: 500 };
	assert.throws(() => getExportAudioClips(f.scenes, 'root', settings), /Generate VOICEVOX/);
	assert.equal(getExportAudioClips(f.scenes, 'root', settings, [f.speech]).length, 2);
	assert.deepEqual(getExportAudioClips(f.scenes, 'root', { ...settings, positionMs: 701, endTimeMs: 900 }), []);
});

// 【書き出しの取消しは生成完了を待たず、共有生成結果は保持する】
// 遅いエンジンでも取消しに応答し、別の利用者が待つ音声まで破棄しないことを確認する。
test('cancels export preparation immediately without discarding shared synthesis', async () => {
	const f = fixture();
	let stored = [];
	let complete;
	const generation = new VoicevoxGeneration({ getScenes: () => f.scenes, getSpeech: () => stored, setSpeech: value => { stored = value; },
		synthesize: () => new Promise(resolve => { complete = resolve; }) });
	const controller = new AbortController();
	const preparation = generation.prepare([f.request], controller.signal);
	const shared = generation.generate(f.request);
	await Promise.resolve();
	controller.abort(new Error('Export cancelled'));
	await assert.rejects(preparation, /Export cancelled/);
	assert.deepEqual(stored, []);
	complete(f.speech);
	await shared;
	assert.deepEqual(stored, [f.speech]);
});

// 【生成WAVを既存のデコーダーと書き出しミキサーで再生する】
// 専用の再生実装を追加せず、開始位置・音量・48kHzへの変換を通常音声と共有できることを確認する。
test('decodes generated WAV through the existing audio export path', async () => {
	const f = fixture();
	const bytes = new Uint8Array(44 + 4800 * 2);
	const view = new DataView(bytes.buffer);
	const text = (at, text) => [...text].forEach((char, index) => { bytes[at + index] = char.charCodeAt(0); });
	text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
	view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
	text(36, 'data'); view.setUint32(40, 9600, true);
	for (let i = 0; i < 4800; i++) view.setInt16(44 + i * 2, 8192, true);
	f.speech.fileData = new Blob([bytes], { type: 'audio/wav' }); f.speech.durationMs = 200;
	f.layer.audioParamValues.volume = literal(0.5);
	const clips = getSceneAudioClips(f.scenes, 'root', { type: 'all' }, createSpeechResolver([f.speech]));
	const renderer = new TimelineAudioExport([], clips, { positionMs: 250, endTimeMs: 300 }, [f.speech]);
	const chunks = [];
	try { await renderer.renderUntil(0.05, pcm => { chunks.push(pcm); return Promise.resolve(); }, new AbortController().signal); }
	finally { renderer.dispose(); }
	assert.ok(Math.abs(chunks[0][0][100] - 0.125) < 1e-6);
	assert.ok(Math.abs(chunks[0][1][100] - 0.125) < 1e-6);
});
