import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { resolveDir: uiDirectory, loader: 'ts', contents: `
		export * from './src/utility/timeline-clip-move.ts';
		export * from './src/utility/timeline-selection.ts';
		export * from './src/utility/timeline-keyframe-lanes.ts';
		export * from './src/utility/timeline-snapping.ts';
		export * from './src/utility/timeline-scene.ts';
		export { createVoicevoxTimelineLayer } from './src/utility/voicevox-timeline-layer.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { getTimelineClipMoveBounds, getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
		export { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
		export { default as arrayDefinition } from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'clip-move-dependencies', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', resolveDir: uiDirectory,
			contents: path === 'effects'
				? "import definition from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts'; export const effectDefinitions = { [definition.id]: definition };"
				: 'export const preferences = { s: { forceTypeSafety: true } };',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { prepareTimelineClipMove, COMMAND_DEFS, UndoRedo, createVoicevoxTimelineLayer, resolveLayerParameter, arrayDefinition, constrainTimelineMove } = module.exports;

const clip = (id, startMs, durationMs) => ({ id, startMs, durationMs, contentOffsetMs: 12.25, assetId: 'sound' });
const keys = times => ({ inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
	keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false,
		keyframes: times.map(x => ({ id: String(x), x, value: x / 1000, interpolation: { type: 'ease:quad', direction: 'inOut' } })) } });
const audioLayer = (id, clips, times) => ({ id, name: id, layerType: 'audio', isDisabled: false, automationGraphs: [], clips, audioParamValues: { volume: keys(times) } });
const times = layer => layer.audioParamValues.volume.keyframesTimeline.keyframes.map(point => point.x);
function fixture(t, layers) {
	t.mock.method(console, 'log', () => {});
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers };
	const state = { timelineScenes: { value: [scene] }, visualModules: { value: [] }, assets: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	const targets = layers.flatMap(layer => layer.clips.map(clip => ({ layerId: layer.id, clipId: clip.id })));
	return { scene, state, history, changes, targets };
}

// 【接触した境界は右クリップに、空白に面する終端は左クリップに追従させる】
// 区間外のキーを巻き込まず、両側を選択した場合も同じキーを二重移動しないことを保証する。
test('assigns touching boundaries to the right clip and exposed endpoints to the left clip', t => {
	const layer = audioLayer('audio', [clip('a', 1000, 1000), clip('b', 2000, 1000), clip('c', 4000, 1000)],
		[999, 1000, 1500, 2000, 3000, 3500, 4000, 5000, 5100]);
	const f = fixture(t, [layer]);
	const selectedTimes = ids => prepareTimelineClipMove(f.state, f.scene, f.targets.filter(target => ids.includes(target.clipId))).keyframes.map(point => point.x);
	assert.deepEqual(selectedTimes(['a']), [1000, 1500]);
	assert.deepEqual(selectedTimes(['b']), [2000, 3000]);
	assert.deepEqual(selectedTimes(['a', 'b']), [1000, 1500, 2000, 3000]);
	assert.deepEqual(selectedTimes(['c']), [4000, 5000]);
});

// 【ドラッグ途中で隣に接触しても終端キーの追従先を変えない】
// 接触後にポインターを戻す際の再判定で、元の終端キーだけ隣の開始位置に取り残さない。
// 確定後の別操作ではその時点の配置から所属を決め直す。
test('keeps endpoint ownership throughout a drag and recalculates it for the next operation', t => {
	const layer = audioLayer('audio', [clip('a', 1000, 1000), clip('b', 2400, 1000)], [1500, 2000]);
	const f = fixture(t, [layer]);
	const targets = [f.targets[0]];
	const initial = prepareTimelineClipMove(f.state, f.scene, targets);
	const payload = { sceneId: 'scene', clips: [{ ...targets[0], initialStartMs: 1000 }], initialKeyframes: initial.keyframes };
	for (const deltaMs of [400, 0, 400]) {
		f.history.commit('moveTimelineClips', { ...payload, deltaMs }, 'drag');
		assert.deepEqual(times(layer), [1500 + deltaMs, 2000 + deltaMs]);
	}
	f.history.commit('moveTimelineClips', { sceneId: 'scene', clips: targets, deltaMs: -100 });
	assert.deepEqual(times(layer), [1800, 2400]);
});

// 【キーの衝突で全クリップを止め、開始時の状態から往復・Undo・Redoする】
// 数値入力とドラッグは同じ制限を使う。移動途中で区間内に入ったキーは巻き込まず、
// クリップ・キーの相対位置、素材位置、値・補間、レンダラーへの通知をまとめて維持する。
test('clamps a multi-layer move at a stationary key and restores the entire edit through history', t => {
	const audio = audioLayer('audio', [clip('a', 1000, 1000)], [900, 1100, 1900, 2000, 2400]);
	const other = audioLayer('other', [clip('b', 500, 1000)], [0, 600]);
	const f = fixture(t, [audio, other]);
	const before = structuredClone(f.scene);
	const move = prepareTimelineClipMove(f.state, f.scene, f.targets);
	const targets = move.clips.map(({ startMs, ...target }) => ({ ...target, initialStartMs: startMs }));
	assert.equal(move.maxDelta, 300);
	assert.equal(move.minDelta, -100);
	for (const deltaMs of [900, 0, -500, 150, 900]) {
		f.history.commit('moveTimelineClips', { sceneId: 'scene', clips: targets, initialKeyframes: move.keyframes, deltaMs }, 'drag');
		if (deltaMs === 0) assert.deepEqual(f.scene, before);
	}
	assert.deepEqual(times(audio), [900, 1400, 2200, 2300, 2400]);
	assert.deepEqual(times(other), [0, 900]);
	assert.deepEqual(f.scene.layers.map(layer => layer.clips[0].startMs), [1300, 800]);
	assert.equal(audio.clips[0].contentOffsetMs, 12.25);
	assert.equal(f.history.undoStack.value.length, 1);
	const after = structuredClone(f.scene);
	for (let repeat = 0; repeat < 2; repeat++) {
		f.history.undo(); assert.deepEqual(f.scene, before);
		f.history.redo(); assert.deepEqual(f.scene, after);
	}
	assert.ok(f.changes.every(changes => changes.length === 2 && changes.every(change =>
		change.changes.some(entry => entry.type === 'clips') && change.changes.some(entry => entry.type === 'parameter' && entry.target === 'audio'))));
	f.history.undo();
	f.history.commit('moveTimelineClips', { sceneId: 'scene', clips: f.targets, deltaMs: 900 });
	assert.deepEqual(f.scene, after);
});

// 【既存の短い間隔と選択キー同士の間隔を保ち、ドラッグを開始位置まで戻せる】
// 開始時に70msしかない隣接キーを100msへ押し広げず、さらに近づく操作だけを止める。
// 複数選択内の10msの間隔や、時刻0からの移動も崩してはいけない。
test('preserves existing short gaps without jumping and keeps selected keys together', t => {
	const layer = audioLayer('audio', [clip('a', 1000, 100)], [930, 1000, 1010, 1170]);
	const f = fixture(t, [layer]);
	const move = prepareTimelineClipMove(f.state, f.scene, f.targets);
	assert.equal(move.minDelta, 0);
	assert.equal(move.maxDelta, 60);
	const payload = { sceneId: 'scene', clips: [{ ...f.targets[0], initialStartMs: 1000 }], initialKeyframes: move.keyframes };
	for (const deltaMs of [60, 0, -100, 60]) {
		f.history.commit('moveTimelineClips', { ...payload, deltaMs }, 'drag');
		assert.deepEqual(times(layer), deltaMs > 0 ? [930, 1060, 1070, 1170] : [930, 1000, 1010, 1170]);
	}
	const zero = audioLayer('zero', [clip('zero', 0, 100)], [0, 10]);
	f.scene.layers.push(zero);
	f.history.commit('moveTimelineClips', { sceneId: 'scene', clips: [{ layerId: 'zero', clipId: 'zero' }], deltaMs: -100 });
	assert.deepEqual(times(zero), [0, 10]);
	assert.equal(zero.clips[0].startMs, 0);
});

// 【発話終了用の空本文キーも追従させ、区間前から続く発話は移動しない】
// 字幕の指定長・読み・声を保ち、通常キーと発話キーのレーンを別々に制限する。
// クリップのトリムや内容オフセットを変更して発話時計をずらすことはしない。
test('moves speech and empty stop keys with parameters while preserving speech settings', t => {
	const layer = createVoicevoxTimelineLayer(0);
	layer.id = 'speech';
	layer.clips = [{ id: 'clip', startMs: 1000, durationMs: 1000, contentOffsetMs: 33.5 }];
	layer.utterances = [100, 1100, 2000, 2500].map(timeMs => ({ id: String(timeMs), timeMs,
		text: timeMs === 2000 ? '' : 'Hello', reading: null, styleId: 7, subtitleDuration: { mode: 'specified', durationMs: 300 } }));
	layer.audioParamValues.volume = keys([1100, 2700]);
	const f = fixture(t, [layer]);
	const before = structuredClone(f.scene);
	f.history.commit('moveTimelineClips', { sceneId: 'scene', clips: f.targets, deltaMs: 1000 });
	assert.deepEqual(layer.utterances.map(point => point.timeMs), [100, 1500, 2400, 2500]);
	assert.deepEqual(times(layer), [1500, 2700]);
	assert.equal(layer.clips[0].startMs, 1400);
	assert.deepEqual(layer.utterances.map(({ timeMs, ...data }) => data), before.layers[0].utterances.map(({ timeMs, ...data }) => data));
	assert.ok(f.changes[0][0].changes.some(change => change.type === 'definition'));
	const after = structuredClone(f.scene);
	f.history.undo(); assert.deepEqual(f.scene, before);
	f.history.redo(); assert.deepEqual(f.scene, after);
});

// 【未設定のVisual Module引数とネストしたレーンは独立したルートへ保存する】
// 既定値を直接変更すると別レイヤーまで動き、単なるコピーを変更すると結果が保存されない。
// 同じ配列要素の複数パラメータを追従させても上書きし合わず、Undoで未設定へ戻す。
test('materializes default arguments and nested lanes without modifying shared definitions', t => {
	for (const nested of [false, true]) {
		const f = fixture(t, []);
		const def = nested ? { ...structuredClone(arrayDefinition.paramDefs.buzzs), id: 'value' }
			: { id: 'value', dataType: { kind: 'scalar' }, ui: { label: 'Value', control: {} }, defaultValue: keys([100, 200]) };
		if (nested) {
			def.defaultValue.value[0].binding.value.x = keys([100, 200]);
			def.defaultValue.value[0].binding.value.y = keys([100, 200]);
		}
		f.state.visualModules.value.push({ id: 'visualModule', paramDefs: [def] });
		for (const id of ['edited', 'untouched']) f.scene.layers.push({ id, layerType: 'visualModule', visualModuleId: 'visualModule',
			visualModuleParamValues: {}, clips: [clip('clip', 100, 200)], compositingParamValues: {} });
		const before = structuredClone(f.scene);
		const defaultBefore = structuredClone(def.defaultValue);
		const targets = [{ layerId: 'edited', clipId: 'clip' }];
		const initial = prepareTimelineClipMove(f.state, f.scene, targets);
		const paths = nested ? [['value', 'first', 'x'], ['value', 'first', 'y']] : [['value']];
		for (const deltaMs of [20, 60, 0, 100]) f.history.commit('moveTimelineClips', {
			sceneId: 'scene', clips: [{ ...targets[0], initialStartMs: 100 }], initialKeyframes: initial.keyframes, deltaMs,
		}, 'defaults');
		for (const path of paths) assert.deepEqual(resolveLayerParameter(f.state, f.scene.layers[0], 'module', path).value.keyframesTimeline.keyframes.map(point => point.x), [200, 300]);
		assert.deepEqual(def.defaultValue, defaultBefore);
		assert.deepEqual(f.scene.layers[1], before.layers[1]);
		const after = structuredClone(f.scene);
		for (let repeat = 0; repeat < 2; repeat++) {
			f.history.undo(); assert.deepEqual(f.scene, before);
			f.history.redo(); assert.deepEqual(f.scene, after);
		}
	}
});

// 【後半のキー検証が失敗してもクリップや前半のキーを変更しない】
// 発話の指定終端が安全な整数範囲を超えるとき、履歴に残らない部分更新を防ぐ。
// ドラッグ中に追従対象を削除した場合も、別のキーで置き換えたり黙って無視したりしない。
test('rejects invalid speech endpoints and missing captured keys atomically', t => {
	const audio = audioLayer('audio', [clip('a', 1000, 1000)], [1100]);
	const speech = createVoicevoxTimelineLayer(1000);
	speech.utterances = [{ id: 'speech', timeMs: 1100, text: 'Hello', reading: null, styleId: 1,
		subtitleDuration: { mode: 'specified', durationMs: Number.MAX_SAFE_INTEGER - 1100 } }];
	const f = fixture(t, [audio, speech]);
	const before = structuredClone(f.scene);
	assert.throws(() => f.history.commit('moveTimelineClips', { sceneId: 'scene', clips: f.targets, deltaMs: 100 }), /Invalid VOICEVOX subtitle duration/);
	assert.deepEqual(f.scene, before);
	const initial = prepareTimelineClipMove(f.state, f.scene, [f.targets[0]]);
	audio.audioParamValues.volume.keyframesTimeline.keyframes = [];
	const deleted = structuredClone(f.scene);
	assert.throws(() => f.history.commit('moveTimelineClips', { sceneId: 'scene', clips: [f.targets[0]], initialKeyframes: initial.keyframes, deltaMs: 100 }), /Timeline keyframe not found/);
	assert.deepEqual(f.scene, deleted);
	assert.equal(f.changes.length, 0);
	assert.equal(f.history.undoStack.value.length, 0);
});

// 【実際のクリップドラッグでもキーの制限をスナップより優先する】
// UIとCommandの制限が異なると、スナップ線だけ先へ進み、往復時にキーを再取得してしまう。
// 境界に到達して戻った場合も、開始時に確定したキーと共通移動量を使うことを確認する。
test('uses the same bounds and captured keys in the actual clip drag handler', async t => {
	const layer = audioLayer('audio', [clip('a', 1000, 1000), clip('b', 2400, 1000)], [1500, 2000, 2400]);
	const f = fixture(t, [layer]);
	const target = f.targets[0];
	let drag;
	const source = await readFile(new URL('../src/components/GsTimeline.vue', import.meta.url), 'utf8');
	const ast = createSourceFile('GsTimeline.vue', parse(source).descriptor.scriptSetup.content, ScriptTarget.Latest);
	const handler = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === 'onClipMoveStart');
	const { code } = await transform(handler.getText(ast), { loader: 'ts' });
	const context = { ...module.exports, deepClone: structuredClone, editedScene: f.scene,
		selection: { value: { kind: 'clips', clips: [target] } }, stopSelectionDrag: { value: undefined },
		tlElWidth: { value: 1000 }, tlRangeX: { value: 1000 }, sceneLayers: { value: f.scene.layers }, clipLayers: { value: f.scene.layers }, stateManager: f.history,
		props: { sceneId: 'scene' }, time: { value: 2400 }, xTicksWithMinor: { value: [] },
		clipSnapSettings: { value: { start: true, end: true } },
		snapSettings: { value: { enabled: true, globalTicks: false, localTicks: false, seekBar: true } },
		revealDetails() {}, resolveClip: target => ({ target, layer, clip: layer.clips.find(clip => clip.id === target.clipId) }),
		startSelectionMove(event, points, times, apply) { drag = { points, times, apply }; },
	};
	const start = new Function('context', `const { ${Object.keys(context).join(', ')} } = context; ${code}; return onClipMoveStart;`)(context);
	start({ button: 0, isPrimary: true }, target);
	const before = structuredClone(f.scene);
	const constrained = constrainTimelineMove(399, drag.points, drag.times, 1);
	assert.equal(constrained.delta, 300);
	assert.equal(constrained.snappingTime, null);
	drag.apply(constrained.delta, 'drag');
	assert.deepEqual(times(layer), [1800, 2300, 2400]);
	drag.apply(0, 'drag');
	assert.deepEqual(f.scene, before);
});

// 【通常キーの実ドラッグも100msと既存の短い間隔を守る】
// 発話キーとの分岐で通常キーだけ重なりを許可する退行を防ぐ。
// コマンドによるルート置換後も、開始時の位置・制約を使って元の短い間隔へ戻す。
test('uses the shared collision gap for ordinary keyframe dragging and allows returning to the initial short gap', async t => {
	const layer = audioLayer('audio', [clip('clip', 0, 5000)], [1000, 1050, 1400]);
	const f = fixture(t, [layer]);
	const point = { layerId: 'audio', target: 'audio', paramPath: ['volume'], keyframeId: '1050' };
	let drag;
	const source = await readFile(new URL('../src/components/GsTimeline.vue', import.meta.url), 'utf8');
	const ast = createSourceFile('GsTimeline.vue', parse(source).descriptor.scriptSetup.content, ScriptTarget.Latest);
	const handler = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === 'onKeyframeMoveStart');
	const { code } = await transform(handler.getText(ast), { loader: 'ts' });
	const context = { ...module.exports,
		selection: { value: { kind: 'keyframes', keyframes: [point] } }, selectedTimelineKeyframes: { value: [point] },
		keyframeEntries: { get value() { return module.exports.getTimelineKeyframeEntries(f.state, f.scene.layers); } },
		stopSelectionDrag: { value: undefined }, tlElWidth: { value: 1000 }, tlRangeX: { value: 1000 },
		sceneLayers: { value: [layer] }, clipLayers: { value: [layer] }, stateManager: f.history, props: { sceneId: 'scene' },
		time: { value: 1400 }, xTicksWithMinor: { value: [] },
		snapSettings: { value: { enabled: true, globalTicks: false, localTicks: false, seekBar: true } },
		revealDetails() {}, startSelectionMove(event, points, times, apply) { drag = { points, times, apply }; },
	};
	const start = new Function('context', `const { ${Object.keys(context).join(', ')} } = context; ${code}; return onKeyframeMoveStart;`)(context);
	start({ button: 0, isPrimary: true }, point);
	assert.equal(drag.points[0].minDelta, 0);
	assert.equal(drag.points[0].maxDelta, 250);
	const constrained = constrainTimelineMove(350, drag.points, drag.times, 1);
	assert.equal(constrained.delta, 250);
	assert.equal(constrained.snappingTime, null);
	drag.apply(constrained.delta, 'drag');
	assert.deepEqual(times(layer), [1000, 1300, 1400]);
	drag.apply(0, 'drag');
	assert.deepEqual(times(layer), [1000, 1050, 1400]);
});
