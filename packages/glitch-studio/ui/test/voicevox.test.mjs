import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: root,
	stdin: { resolveDir: root, loader: 'ts', contents: `
		export * from './src/audio/voicevox-generation.ts';
		export * from './src/utility/voicevox-timeline-layer.ts';
		export { createTextTimelineLayer } from './src/utility/text-timeline-layer.ts';
		export { resolveLayerParameter, getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { validateVoicevoxSubtitle } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle-validation.ts';
		export * from './src/gsproj.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { TimelineAudioExport } from './src/export/timeline-audio-export.ts';
		export { getExportAudioClips } from './src/export/audio-export-settings.ts';
		export * from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
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
	getSceneAudioClips, TimelineAudioRenderer, VoicevoxGeneration, getRequiredVoicevoxRequests,
	COMMAND_DEFS, UndoRedo, encodeProjectFile, decodeProjectFile, TimelineAudioExport, getExportAudioClips,
	createTextTimelineLayer, resolveLayerParameter, getLayerKeyframeParameters, validateVoicevoxSubtitle } = module.exports;
const literal = value => ({ inputSource: 'literal', value });
const utterance = (id, timeMs, text = 'Hello', reading = null) => ({ id, timeMs, text, reading });
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
	assert.equal(getVoicevoxSubtitle(f.layer.utterances, 99), '');
	assert.equal(getVoicevoxSubtitle(f.layer.utterances, 100), 'Hello');
	assert.equal(getVoicevoxSubtitle(f.layer.utterances, 600), '');
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
test('persists generated speech separately from assets and keeps pending utterances', async () => {
	const f = fixture();
	f.layer.utterances.push(utterance('pending', 650, 'Not generated', '別の読み'));
	const project = { id: 'p', gsVersion: '2.0.0-alpha.1', name: 'Speech', description: '', author: '', timelineFps: 60,
		timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, resolution: { width: 640, height: 480 },
		assets: [], players: [], visualModules: [], timelineScenes: f.scenes, generatedSpeech: [f.speech] };
	const restored = decodeProjectFile(await encodeProjectFile(project));
	assert.deepEqual(restored.timelineScenes, f.scenes);
	assert.deepEqual(restored.assets, []);
	assert.deepEqual(new Uint8Array(await restored.generatedSpeech[0].fileData.arrayBuffer()), Uint8Array.of(1, 2, 3));
	assert.deepEqual(restored.generatedSpeech[0].audioQuery, f.speech.audioQuery);
	assert.equal(getSceneAudioClips(restored.timelineScenes, 'root', { type: 'all' }, createSpeechResolver(restored.generatedSpeech)).length, 2);
});

// 【表示や配置だけを変えたときは音声を再合成しない】
// 読みを明示した発話は表示本文が異なっても共有し、声・話速の変更だけを別要求にする。
test('keys synthesis by reading and voice settings rather than placement or subtitles', () => {
	const settings = { styleId: 1, speedScale: 1 };
	const first = getVoicevoxRequestKey(getVoicevoxRequest(settings, utterance('a', 0, 'WebGPU', 'ウェブジーピーユー')));
	assert.equal(first, getVoicevoxRequestKey(getVoicevoxRequest(settings, utterance('b', 1234, 'WEB GPU', 'ウェブジーピーユー'))));
	assert.notEqual(first, getVoicevoxRequestKey(getVoicevoxRequest({ ...settings, speedScale: 1.5 }, utterance('a', 0, 'WebGPU', 'ウェブジーピーユー'))));
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
