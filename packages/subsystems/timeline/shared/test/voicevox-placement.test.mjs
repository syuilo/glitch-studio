import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getVoicevoxUtterancePlacements, assignPreparedSpeech } = await loadSource(fileURLToPath(new URL('../src/layers/voicevox/voicevox-placement.ts', import.meta.url)));
const { getSceneAudioPlacements, resolveSceneAudioPlacements } = await loadSource(fileURLToPath(new URL('../src/scene-audio.ts', import.meta.url)));
const { getRequiredVoicevoxRequests, getRequiredVoicevoxRequestsForRendering } = await loadSource(fileURLToPath(new URL('../src/voicevox-requests.ts', import.meta.url)));
const settings = { speedScale: 1 };
const utterance = (id, timeMs, text) => ({ id, timeMs, text, reading: null, styleId: 1 });
const clip = (id, startMs, durationMs) => ({ id, startMs, durationMs, contentOffsetMs: 987.5 });

// 【音声未生成でも次のキー・空文字・クリップ境界で配置を決める】
// UIと生成対象の列挙で同じ規則を使い、クリップの間をまたいでも音声の原点は動かさない。
test('places utterances independently of synthesis without restarting after gaps', () => {
	const utterances = [utterance('last', 600, 'Last'), utterance('clear', 500, ''), utterance('first', 100, 'First'), utterance('middle', 400, 'Middle')];
	const placements = getVoicevoxUtterancePlacements(settings, utterances, [clip('left', 200, 100), clip('right', 350, 400)]);
	assert.deepEqual(placements.map(p => [p.utteranceId, p.clipId, p.sourceStartMs, p.startMs, p.endMs]), [
		['first', 'left', 100, 200, 300], ['first', 'right', 100, 350, 400],
		['middle', 'right', 400, 400, 500], ['last', 'right', 600, 600, 750],
	]);
	assert.deepEqual(utterances.map(key => key.id), ['last', 'clear', 'first', 'middle']);
	const speech = { key: 'first', sourceId: 'audio', durationMs: 175.5 };
	assert.deepEqual(assignPreparedSpeech(placements[0], speech), { sourceId: 'audio', sourceStartMs: 100, startMs: 200, endMs: 275.5 });
	assert.equal(assignPreparedSpeech(placements[1], speech), undefined);
	assert.deepEqual(getVoicevoxUtterancePlacements(settings, utterances, []), []);
});

// 【親Sceneのトリムを適用した配置から生成対象と音声計画を作る】
// 未生成と生成済みだが短くて聞こえない音声を区別し、音声長を仮装せず書き出しを検証する。
test('resolves nested speech placements and distinguishes missing from exhausted audio', () => {
	const volume = { volume: { inputSource: 'literal', value: 1 } };
	const speechLayer = { id: 'speech', name: 'Speech', layerType: 'voicevox', isDisabled: false, automationGraphs: [],
		audioParamValues: volume, compositingParamValues: {}, subtitleParamValues: {}, voicevox: settings,
		utterances: [utterance('first', 100, 'First'), utterance('last', 400, 'Last')], clips: [clip('speech', 200, 500)] };
	const parent = { id: 'parent', name: 'Parent', layerType: 'scene', isDisabled: false, automationGraphs: [],
		audioParamValues: volume, compositingParamValues: {}, clips: [{ ...clip('parent', 1000, 300), contentOffsetMs: 250, sceneId: 'child' }] };
	const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });
	const scenes = [scene('root', [parent]), scene('child', [speechLayer])];
	const placements = getSceneAudioPlacements(scenes, 'root');
	assert.deepEqual(placements.map(p => [p.sourceStartMs, p.startMs, p.endMs]), [[850, 1000, 1150], [1150, 1150, 1300]]);
	assert.deepEqual(getRequiredVoicevoxRequests(scenes, 'root', 1150, 1300).map(request => request.text), ['Last']);
	assert.deepEqual(getRequiredVoicevoxRequests(scenes, 'root', 1300, 1500), []);
	const resolved = resolveSceneAudioPlacements(placements, request => request.text === 'First' ? { key: 'first', sourceId: 'first', durationMs: 100 } : undefined);
	assert.deepEqual(resolved.clips, []);
	assert.deepEqual(resolved.missingSpeech.map(p => p.request.text), ['Last']);
	parent.isDisabled = true;
	assert.deepEqual(getRequiredVoicevoxRequests(scenes, 'root', 0, 1500), []);
});

function speechHistoryFixture() {
	const volume = { volume: { inputSource: 'literal', value: 1 } };
	const speech = { id: 'speech', name: 'Speech', layerType: 'voicevox', isDisabled: false, automationGraphs: [],
		audioParamValues: volume, compositingParamValues: {}, subtitleParamValues: {}, voicevox: settings,
		utterances: [utterance('first', 0, 'First')], clips: [clip('speech', 0, 500)] };
	const waveform = { id: 'waveform', name: 'Waveform', layerType: 'effect', isDisabled: false, automationGraphs: [],
		compositingParamValues: {}, effectId: 'audioWaveform', resolution: { mode: 'auto' },
		effectParamValues: { audio: { inputSource: 'lowerLayerAudio' }, duration: { inputSource: 'literal', value: 1 } },
		clips: [clip('waveform', 0, 3000)] };
	const parent = { id: 'parent', name: 'Parent', layerType: 'scene', isDisabled: false, automationGraphs: [],
		audioParamValues: volume, compositingParamValues: {},
		clips: [{ ...clip('parent', 0, 1000), contentOffsetMs: 500, sceneId: 'child' }] };
	const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });
	return { speech, parent, scene, scenes: [scene('root', [parent]), scene('child', [waveform, speech])] };
}

// 【親のトリム前に終了した発話も子Sceneの波形用に準備する】
// 親の冒頭で子の500msを描くと、過去1秒の窓には子の0〜500msの発話が含まれる。
// 親の音声トラックが無音でも、この生成要求を落とすと書き出した波形だけが消える。
test('prepares child audio history even when trimming removes all audible speech', () => {
	const f = speechHistoryFixture();
	assert.deepEqual(getSceneAudioPlacements(f.scenes, 'root'), []);
	assert.deepEqual(getRequiredVoicevoxRequests(f.scenes, 'root', 0, 1000), []);
	assert.deepEqual(getRequiredVoicevoxRequestsForRendering(f.scenes, 'root', 0, 1000).map(request => request.text), ['First']);
	// 描画用に準備しても、親のトリムを外して音声トラックへ混ぜることはしない。
	const prepared = () => ({ key: 'first', sourceId: 'first', durationMs: 500 });
	assert.deepEqual(resolveSceneAudioPlacements(getSceneAudioPlacements(f.scenes, 'root'), prepared).clips, []);
	assert.equal(resolveSceneAudioPlacements(getSceneAudioPlacements(f.scenes, 'child'), prepared).clips.length, 1);
});

// 【多段のScene配置と複数の内容区間でも履歴を集め、無関係な配置は除外する】
// Scene IDだけで訪問済みにすると、後の配置が参照する発話を落としてしまう。
// 無効・範囲外・子の終端後の配置は合成を要求せず、同じ発話の要求は一度にまとめる。
test('collects history across nested and repeated scene placements without including inactive branches', () => {
	const f = speechHistoryFixture();
	f.speech.clips = [clip('speech', 0, 3000)];
	f.speech.utterances = [utterance('first', 0, 'First'), utterance('clear-first', 500, ''),
		utterance('later', 1400, 'Later'), utterance('clear-later', 1500, ''), utterance('future', 2200, 'Future')];
	f.parent.clips = [
		{ ...clip('early', 0, 100), contentOffsetMs: 500, sceneId: 'child' },
		{ ...clip('late', 1000, 100), contentOffsetMs: 1500, sceneId: 'child' },
	];
	const excluded = structuredClone(f.scenes[1]);
	excluded.id = 'excluded';
	excluded.layers[1].utterances = [utterance('excluded', 0, 'Excluded')];
	for (const [id, startMs, contentOffsetMs, isDisabled] of [
		['disabled', 0, 0, true], ['outside', 2000, 0, false], ['exhausted', 0, 3000, false],
	]) f.scenes[0].layers.push({ ...f.parent, id, isDisabled,
		clips: [{ ...clip(id, startMs, 100), contentOffsetMs, sceneId: 'excluded' }] });
	const outer = { ...f.parent, id: 'outer', clips: [{ ...clip('outer', 5000, 2000), contentOffsetMs: 0, sceneId: 'root' }] };
	f.scenes.push(excluded, f.scene('outer', [outer]));
	assert.deepEqual(getRequiredVoicevoxRequestsForRendering(f.scenes, 'outer', 5000, 6100).map(request => request.text), ['First', 'Later']);
	assert.deepEqual(getRequiredVoicevoxRequestsForRendering(f.scenes, 'outer', 5000, 5100).map(request => request.text), ['First']);
	assert.deepEqual(getRequiredVoicevoxRequestsForRendering(f.scenes, 'outer', 5000, 5000), []);
	f.speech.isDisabled = true;
	assert.deepEqual(getRequiredVoicevoxRequestsForRendering(f.scenes, 'outer', 5000, 6100), []);
});
