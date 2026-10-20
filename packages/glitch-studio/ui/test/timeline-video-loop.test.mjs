import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createDragActionsFixture } from './helpers/timeline-drag-actions.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { createTimelineDragActions } from './src/utility/timeline-drag-actions.ts';
		export { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
		export * from './src/utility/timeline-selection.ts';
		export * from './src/utility/timeline-ticks.ts';
		export * from './src/utility/timeline-clip-clipboard.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'video-loop-dependencies', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', contents: path === 'effects'
			? 'export const effectDefinitions = {};'
			: 'export const preferences = { s: { forceTypeSafety: true } };' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const api = module.exports;
const target = { sceneId: 'scene', layerId: 'video', clipId: 'clip' };

function fixture(t) {
	t.mock.method(console, 'log', () => {});
	const clip = { id: 'clip', assetId: 'movie', audioEnabled: true, videoEnabled: true, startMs: 1000, durationMs: 3000, sourceInMs: 2000.25, sourceOutMs: 5000.25, playbackRate: 1, loop: false };
	const layer = { id: 'video', name: 'Video', layerType: 'video', isDisabled: false, automationGraphs: [],
		clips: [clip, { ...clip, id: 'next', startMs: 12000 }], compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] };
	const state = { timelineScenes: { value: [scene] }, assets: { value: [{ id: 'movie', fileDataType: 'video/mp4', fileData: new Blob() }] }, visualModules: { value: [] } };
	const history = new api.UndoRedo(state, api.COMMAND_DEFS);
	const project = { state, history, scene, layer, clip };
	return { ...project, drag: createDragActionsFixture(api, project, { mediaInfo: new Map([['movie', { durationMs: 6000.25, audioAvailable: true }]]) }) };
}

// 【速度変更は素材範囲とキーを保ち、一回のUndoで方向と長さを戻す】
// 速度がクリップ単位であること、ループの端数周も同じ倍率で伸縮することを確認する。
test('changes clip speed and reverse direction with atomic undo and loop retiming', t => {
	const f = fixture(t);
	const before = structuredClone(f.clip);
	const volume = structuredClone(f.layer.audioParamValues);
	f.history.commit('editMediaClipPlaybackRate', { ...target, playbackRate: -0.5, sourceDurationMs: 6000.25 });
	assert.deepEqual(f.clip, { ...before, playbackRate: -0.5, durationMs: 6000 });
	assert.deepEqual(f.layer.audioParamValues, volume);
	f.history.undo();
	assert.deepEqual(f.clip, before);
	f.history.redo();
	assert.equal(f.clip.playbackRate, -0.5);
	f.history.undo();
	f.history.commit('editMediaClipLoop', { ...target, deltaMs: 5000, sourceDurationMs: 6000.25 });
	f.history.commit('editMediaClipPlaybackRate', { ...target, playbackRate: 2, sourceDurationMs: 6000.25 });
	assert.deepEqual([f.clip.durationMs, f.clip.sourceInMs, f.clip.sourceOutMs, f.clip.loop], [4000, 2000.25, 5000.25, true]);
});

// 【音声のみの設定はクリップ単位でUndoでき、コピー・保存・素材変更でも保持する】
// 映像を無効にしても音声・素材時計・隣のクリップを変更しない。素材変更は通常再生の
// 時計を作り直すため、その際に映像の有効状態を既定値へ戻してしまう回帰も防ぐ。
test('undoes and persists audio-only clip settings through clipboard and source replacement', async t => {
	const f = fixture(t);
	const original = structuredClone(f.clip);
	const neighbor = structuredClone(f.layer.clips[1]);
	f.history.commit('editVideoClipVideoEnabled', { ...target, videoEnabled: false });
	assert.deepEqual(f.clip, { ...original, videoEnabled: false });
	assert.deepEqual(f.layer.clips[1], neighbor);
	f.history.undo();
	assert.deepEqual(f.clip, original);
	f.history.redo();
	assert.equal(f.clip.videoEnabled, false);
	assert.deepEqual(api.COMMAND_DEFS.editVideoClipVideoEnabled.changes(f.state, target),
		[{ type: 'layer', sceneId: 'scene', layerId: 'video', changes: [{ type: 'clips' }] }]);
	const clipboard = api.copyTimelineClips(f.scene, [target]);
	const paste = api.prepareTimelineClipPaste(f.scene, clipboard, 16000);
	f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips: paste,
		sourceDurationsMs: { video: { [paste[0].clip.id]: 6000.25 } } });
	assert.deepEqual(f.layer.clips.at(-1), { ...original, videoEnabled: false, id: paste[0].clip.id, startMs: 16000 });
	const encoded = await api.encodeProjectFile({ generatedSpeech: [], timelineFps: 60,
		timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: [], timelineScenes: [f.scene] });
	assert.deepEqual(api.decodeProjectFile(encoded).timelineScenes[0], f.scene);
	f.history.commit('changeTimelineClipSource', { ...target, assetId: 'movie', sourceDurationMs: 4000 });
	assert.equal(f.clip.videoEnabled, false);
	assert.equal(f.clip.audioEnabled, true);
	f.history.undo();
	assert.deepEqual(f.clip, { ...original, videoEnabled: false });
});

// 【隣接クリップと衝突する速度変更は、素材範囲・配置・履歴を部分変更しない】
// 長さを勝手に切り詰めたり、他のクリップを押し出したりせず、ユーザーが配置を選べるようにする。
test('rejects overlapping speed changes without altering any clips or keys', t => {
	const f = fixture(t);
	const before = structuredClone(f.scene);
	assert.throws(() => f.history.commit('editMediaClipPlaybackRate', { ...target, playbackRate: 0.25, sourceDurationMs: 6000.25 }), /Overlapping/);
	assert.deepEqual(f.scene, before);
	assert.equal(f.history.undoStack.value.length, 0);
});

// 【ループ延長は素材長を超えても隣接クリップで止まり、往復ドラッグを一回でUndoできる】
// ループ開始後の長さを周期として再採用したり、戻した後の再延長で周期を失ったりしてはいけない。
test('resizes loops from the gesture snapshot and preserves merged undo and redo', t => {
	const f = fixture(t);
	f.drag.actions.onClipTrimStart({}, target, 'loop');
	assert.deepEqual(f.drag.move.points[0], { time: 4000, minDelta: 0, maxDelta: 8000, snapTimes: null, snapPeriod: { startMs: 1000, durationMs: 3000 } });
	for (const delta of [5000, 0, 20000]) f.drag.move.apply(delta, 'loop-drag');
	assert.deepEqual([f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [11000, 3000]);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual([f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [3000, null]);
	f.history.redo();
	assert.deepEqual([f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [11000, 3000]);
	assert.deepEqual(api.constrainTimelineMove(2998, f.drag.move.points, f.drag.move.times, 1), { delta: 3000, snappingTime: 7000 });
});

// 【周期のトリムとループ解除は独立した履歴を持ち、全体終端を維持する】
// 通常ハンドルの吸着元は全体終端ではなく一周目の終端。左トリムでは素材オフセットも進める。
test('trims each repeated range without moving the overall end', t => {
	const f = fixture(t);
	f.history.commit('editMediaClipLoop', { ...target, deltaMs: 5000, sourceDurationMs: 6000.25 });
	f.drag.actions.onClipTrimStart({}, target, 'end');
	assert.equal(f.drag.move.points[0].time, 4000);
	f.drag.move.apply(-1000, 'source-trim');
	assert.deepEqual([f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [8000, 2000]);
	f.drag.actions.onClipTrimStart({}, target, 'start');
	f.drag.move.apply(500, 'left-trim');
	assert.deepEqual([f.clip.startMs, f.clip.durationMs, f.clip.sourceInMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [1500, 7500, 2500.25, 1500]);
	f.history.commit('editMediaClipLoop', { ...target, deltaMs: -10000, sourceDurationMs: 6000.25 });
	assert.deepEqual([f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [1500, null]);
	f.history.undo();
	assert.deepEqual([f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [7500, 1500]);
	f.history.undo();
	f.history.undo();
	assert.deepEqual([f.clip.startMs, f.clip.durationMs, f.clip.sourceInMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [1000, 8000, 2000.25, 3000]);
});

// 【コピー・保存は周期を保持し、素材差し替えだけがトリムとループをリセットする】
// 全体長を素材長と比較する旧検証では、正常なループ済みクリップを貼り付けられなくなる。
test('preserves loops in clipboard and project files and resets them on source replacement', async t => {
	const f = fixture(t);
	f.history.commit('editMediaClipLoop', { ...target, deltaMs: 5000, sourceDurationMs: 6000.25 });
	const clipboard = api.copyTimelineClips(f.scene, [target]);
	const paste = api.prepareTimelineClipPaste(f.scene, clipboard, 16000);
	f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips: paste, sourceDurationsMs: { video: { [paste[0].clip.id]: 6000.25 } } });
	assert.equal((f.layer.clips.at(-1).sourceOutMs - f.layer.clips.at(-1).sourceInMs), 3000);
	assert.equal(f.layer.clips.at(-1).durationMs, 8000);
	const encoded = await api.encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: [], timelineScenes: [f.scene] });
	assert.deepEqual(api.decodeProjectFile(encoded).timelineScenes[0], f.scene);
	f.history.commit('changeTimelineClipSource', { ...target, assetId: 'movie', sourceDurationMs: 4000 });
	assert.deepEqual([f.clip.sourceInMs, f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [0, 4000, null]);
	f.history.undo();
	assert.deepEqual([f.clip.sourceInMs, f.clip.durationMs, (f.clip.loop ? f.clip.sourceOutMs - f.clip.sourceInMs : null)], [2000.25, 8000, 3000]);
});

// 【ローカル目盛りは周回ごとに素材時刻へ戻し、最後の端数周までだけ表示する】
// 線形の内容時刻を表示すると、繰り返し部分で未使用の素材範囲を再生しているように見えてしまう。
// 極端なズームアウトでは読めない目盛りを省き、巨大な配列の生成を避ける。
test('repeats source-time ticks within the visible interval', () => {
	const clip = { startMs: 1000, durationMs: 8000, sourceInMs: 2000, sourceOutMs: 5000, playbackRate: 1, loop: true };
	const ticks = api.getTimelineClipTicks(clip, 0, 10000, 10, 'decimal125', { halves: false, thirds: false });
	assert.deepEqual(ticks.major.filter(tick => tick.contentTimeMs === 2000).map(tick => tick.sceneTimeMs), [1000, 4000, 7000]);
	assert.ok(ticks.major.every(tick => tick.sceneTimeMs < 9000 && tick.contentTimeMs < 5000));
	assert.deepEqual(api.getTimelineClipTicks({ ...clip, durationMs: 3600000, sourceOutMs: clip.sourceInMs + 1 }, 0, 3600000, 10), { major: [], minor: [] });
});

// 【固定表示の切り替え・地点変更・トリムは一回ずつUndoでき、旧時計を残さない】
// 固定表示を素材範囲の再生として検証すると伸縮できなくなる。左端を戻すドラッグと
// Redoでも固定地点と音声無効が維持され、通常再生へのUndoでは元の速度・音声を戻す。
test('holds frames and resizes the placement with reversible timing model changes', t => {
	const f = fixture(t);
	f.clip.playbackRate = -1;
	const original = structuredClone(f.clip);
	f.history.commit('holdVideoClipFrame', { ...target, sourceTimeMs: 2345.25, sourceDurationMs: 6000.25 });
	const held = { id: 'clip', assetId: 'movie', startMs: 1000, durationMs: 3000, sourceTimeMs: 2345.25, audioEnabled: false, videoEnabled: true };
	assert.deepEqual(f.clip, held);
	assert.throws(() => f.history.commit('editVideoClipAudio', { ...target, audioEnabled: true }), /silent/);
	assert.throws(() => f.history.commit('editVideoClipVideoEnabled', { ...target, videoEnabled: false }), /video enabled/);
	assert.throws(() => f.history.commit('editMediaClipLoop', { ...target, deltaMs: 1000, sourceDurationMs: 6000.25 }), /Media clip not found/);
	assert.throws(() => f.history.commit('holdVideoClipFrame', { ...target, sourceTimeMs: 6000.25, sourceDurationMs: 6000.25 }), /within/);
	assert.deepEqual(f.clip, held);
	f.drag.actions.onClipTrimStart({}, target, 'start');
	f.drag.move.apply(-500, 'hold-left');
	f.drag.move.apply(-1000, 'hold-left');
	assert.deepEqual(f.clip, { ...held, startMs: 0, durationMs: 4000 });
	f.history.undo();
	assert.deepEqual(f.clip, held);
	f.history.redo();
	assert.deepEqual(f.clip, { ...held, startMs: 0, durationMs: 4000 });
	f.drag.actions.onClipTrimStart({}, target, 'end');
	f.drag.move.apply(20000, 'hold-right');
	assert.deepEqual(f.clip, { ...held, startMs: 0, durationMs: 12000 });
	f.history.undo();
	f.history.undo();
	f.history.undo();
	assert.deepEqual(f.clip, original);
	f.history.redo();
	assert.deepEqual(f.clip, held);
	f.history.commit('holdVideoClipFrame', { ...target, sourceTimeMs: 100.125, sourceDurationMs: 6000.25 });
	assert.equal(f.clip.sourceTimeMs, 100.125);
	f.history.undo();
	assert.deepEqual(f.clip, held);
	assert.deepEqual(api.getTimelineClipTicks(held, 0, 10000, 10), { major: [], minor: [] });
});

// 【固定地点と素材より長い表示区間をコピー・保存し、素材変更のUndoでも復元する】
// 素材変更で通常再生へ戻るときに固定地点が残ると、動画を差し替えても静止し続ける。
// 貼り付けでは表示長でなく固定地点を素材長と照合し、他のクリップには影響させない。
test('persists and pastes held video and removes hold timing during source replacement', async t => {
	const f = fixture(t);
	f.history.commit('holdVideoClipFrame', { ...target, sourceTimeMs: 2345.25, sourceDurationMs: 6000.25 });
	f.history.commit('editTimelineClipTiming', { ...target, edge: 'end', deltaMs: 7000, sourceDurationMs: 6000.25 });
	const held = structuredClone(f.clip);
	const clipboard = api.copyTimelineClips(f.scene, [target]);
	const paste = api.prepareTimelineClipPaste(f.scene, clipboard, 16000);
	assert.throws(() => f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips: paste,
		sourceDurationsMs: { video: { [paste[0].clip.id]: 2000 } } }), /within/);
	f.history.commit('pasteTimelineClips', { sceneId: 'scene', clips: paste,
		sourceDurationsMs: { video: { [paste[0].clip.id]: 6000.25 } } });
	assert.deepEqual(f.layer.clips.at(-1), { ...held, id: paste[0].clip.id, startMs: 16000 });
	const encoded = await api.encodeProjectFile({ generatedSpeech: [], timelineFps: 60,
		timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: [], timelineScenes: [f.scene] });
	assert.deepEqual(api.decodeProjectFile(encoded).timelineScenes[0], f.scene);
	f.history.commit('changeTimelineClipSource', { ...target, assetId: 'movie', sourceDurationMs: 4000 });
	assert.equal('sourceTimeMs' in f.clip, false);
	assert.deepEqual([f.clip.sourceInMs, f.clip.playbackRate, f.clip.loop, f.clip.durationMs], [0, 1, false, 4000]);
	f.history.undo();
	assert.deepEqual(f.clip, held);
	f.history.redo();
	assert.equal('sourceTimeMs' in f.clip, false);
});
