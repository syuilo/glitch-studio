import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getVoicevoxUtterancePlacements, assignPreparedSpeech } = await loadSource(fileURLToPath(new URL('../src/layers/voicevox/voicevox-placement.ts', import.meta.url)));
const { getSceneAudioPlacements, resolveSceneAudioPlacements } = await loadSource(fileURLToPath(new URL('../src/scene-audio.ts', import.meta.url)));
const { getRequiredVoicevoxRequests } = await loadSource(fileURLToPath(new URL('../src/voicevox-requests.ts', import.meta.url)));
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
