import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const [exportBundle, workerBundle] = await Promise.all([
	build({ stdin: {
		contents: `export { TimelineAudioExport } from './export/timeline-audio-export.ts';
			export { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';`,
		resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
	}, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'] }),
	build({ entryPoints: [fileURLToPath(new URL('../src/audio/timeline-audio.worker.ts', import.meta.url))],
		bundle: true, platform: 'node', format: 'cjs', write: false, external: ['mediabunny'] }),
]);
const module = { exports: {} };
new Function('require', 'module', 'exports', exportBundle.outputFiles[0].text)(require, module, module.exports);
const { TimelineAudioExport, getSceneAudioClips } = module.exports;
const sampleRate = 48000;

function stereoWav() {
	const frames = sampleRate;
	const buffer = new ArrayBuffer(44 + frames * 4);
	const view = new DataView(buffer);
	const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
	text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
	view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true);
	view.setUint16(32, 4, true); view.setUint16(34, 16, true);
	text(36, 'data'); view.setUint32(40, frames * 4, true);
	for (let frame = 0; frame < frames; frame++) {
		const value = frame < sampleRate / 5 ? 8192 : 16384;
		view.setInt16(44 + frame * 4, value, true);
		view.setInt16(46 + frame * 4, -value / 2, true);
	}
	return { id: 'sound', name: 'Stereo.wav', fileDataType: 'audio/wav', fileData: new Blob([buffer]) };
}

function fixture() {
	const literal = value => ({ inputSource: 'literal', value });
	const audioLayer = (id, startMs, durationMs, contentOffsetMs, volume) => ({
		id, name: id, layerType: 'audio', isDisabled: false, automationGraphs: [], audioParamValues: { volume },
		clips: [{ id: 'clip', assetId: 'sound', startMs, durationMs, contentOffsetMs }],
	});
	const root = { id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [
		audioLayer('main', 100, 400, 50, literal(0.5)),
		{ id: 'placement', name: 'Child', layerType: 'scene', isDisabled: false, automationGraphs: [],
			audioParamValues: { volume: literal(2) }, compositingParamValues: {},
			clips: [{ id: 'clip', sceneId: 'child', startMs: 200, durationMs: 250, contentOffsetMs: 100 }] },
		{ ...audioLayer('disabled', 0, 600, 0, literal(1)), isDisabled: true,
			clips: [{ id: 'clip', assetId: 'missing', startMs: 0, durationMs: 600, contentOffsetMs: 0 }] },
		{ ...audioLayer('silent-video', 0, 600, 0, literal(1)), layerType: 'video', compositingParamValues: {},
			clips: [{ id: 'clip', assetId: 'missing-video', audioEnabled: false, startMs: 0, durationMs: 600, contentOffsetMs: 0 }] },
	] };
	const child = { id: 'child', name: 'Child', resolution: { mode: 'project' },
		layers: [audioLayer('child-sound', 0, 500, 20, { inputSource: 'expression', expression: 'TIME_MS / 1000' })] };
	return { assets: [stereoWav()], clips: getSceneAudioClips([root, child], 'root'), endFrame: 600 * sampleRate / 1000 };
}

function startPlayback(settings, startMs) {
	const waiting = [];
	// 通信口だけを置き換え、Worker本体・デコーダー・ミキサーは実装をそのまま実行する。
	const worker = { postMessage(message) { waiting.shift()(message); } };
	new Function('require', 'self', workerBundle.outputFiles[0].text)(require, worker);
	worker.onmessage({ data: { type: 'start', ...settings, sampleRate, startFrame: startMs * sampleRate / 1000 } });
	return {
		pull() {
			const packet = Promise.withResolvers();
			waiting.push(packet.resolve);
			worker.onmessage({ data: { type: 'pull' } });
			return packet.promise;
		},
	};
}

function collectPackets(packets, frames = packets.reduce((count, packet) => count + packet[0].length, 0)) {
	const result = [new Float32Array(frames), new Float32Array(frames)];
	let offset = 0;
	for (const packet of packets) {
		const count = Math.min(packet[0].length, frames - offset);
		if (count <= 0) break;
		result.forEach((channel, index) => channel.set(packet[index].subarray(0, count), offset));
		offset += count;
	}
	assert.equal(offset, frames);
	return result;
}

async function exportAudio(settings, startMs, endMs, renderUntil = [(endMs - startMs) / 1000]) {
	const exporter = new TimelineAudioExport(settings.assets, settings.clips, { positionMs: startMs, endTimeMs: endMs });
	const packets = [];
	let writtenFrames = 0;
	try {
		for (const time of renderUntil) await exporter.renderUntil(time, async (pcm, timestamp) => {
			assert.equal(timestamp, writtenFrames / sampleRate);
			writtenFrames += pcm[0].length;
			packets.push(pcm);
		}, new AbortController().signal);
	} finally { exporter.dispose(); }
	assert.equal(writtenFrames, (endMs - startMs) * sampleRate / 1000);
	return collectPackets(packets);
}

// 【再生Workerと書き出しが同じ素材・Scene時刻から同じPCMを生成する】
// パッケージ移設後の接続を実際のWAVデコードまで通して検証する。先読みの250msと
// 書き出しの4096サンプルで区切りが違っても、途中開始・子Sceneのトリム・各階層の音量を維持する。
// 無効なレイヤーや音声無効の動画は、参照切れの素材でも読み出さない。
test('matches playback worker PCM and export PCM across seeks and nested scene trims', { timeout: 10000 }, async () => {
	const settings = fixture();
	const playback = startPlayback(settings, 150);
	// 再生側の先読みと同じく複数要求を先に送り、Worker内の直列処理も通す。
	const packets = await Promise.all([playback.pull(), playback.pull()]);
	assert.ok(packets.every(packet => packet.type === 'pcm'));
	const preview = collectPackets(packets.map(packet => packet.channels), 400 * sampleRate / 1000);
	const exported = await exportAudio(settings, 150, 550, [0.123, 0.4, 0.5]);
	assert.deepEqual(preview, exported);
	const sampleAt = timeMs => exported[0][(timeMs - 150) * sampleRate / 1000];
	assert.equal(sampleAt(160), 0.125);
	assert.ok(Math.abs(sampleAt(250) - 0.325) < 0.000001);
	assert.ok(Math.abs(sampleAt(300) - 0.45) < 0.000001);
	assert.equal(sampleAt(450), 0.25);
	assert.ok(exported[0].subarray(350 * sampleRate / 1000).every(value => value === 0));
	assert.deepEqual(exported[1], exported[0].map(value => value === 0 ? 0 : -value / 2));
});

// 【再生ループをまたぐ先読みがScene末尾と先頭を欠落なくつなぐ】
// デコードキャッシュとTimelineミキサーを分離しても、ループ開始で素材オフセットや
// 音量の時計を継続してはいけない。書き出したScene全体の該当区間と比較する。
test('joins the scene end and beginning when a playback packet crosses the loop boundary', { timeout: 10000 }, async () => {
	const settings = fixture();
	const whole = await exportAudio(settings, 0, 600);
	const packet = await startPlayback(settings, 550).pull();
	assert.equal(packet.type, 'pcm');
	const expected = collectPackets([
		whole.map(channel => channel.subarray(550 * sampleRate / 1000)),
		whole.map(channel => channel.subarray(0, 200 * sampleRate / 1000)),
	]);
	assert.deepEqual(packet.channels, expected);
});

// 【音声レンダラーを共通化しても書き出し用の評価スコープを失わない】
// IS_EXPORTを使う音量は意図的に再生時と異なる。両経路を単に同一結果へ揃える変更を防ぐ。
test('retains the explicit export flag in the audio expression scope', { timeout: 10000 }, async () => {
	const settings = fixture();
	settings.clips = [{ sourceId: 'sound', sourceStartMs: 0, startMs: 0, endMs: 600,
		gains: [{ sceneStartMs: 0, volume: { inputSource: 'expression', expression: 'if IS_EXPORT { 1 } else { 0.5 }' }, automationGraphs: [] }] }];
	const preview = await startPlayback(settings, 50).pull();
	assert.equal(preview.type, 'pcm');
	const exported = await exportAudio(settings, 50, 150);
	assert.equal(preview.channels[0][0], 0.125);
	assert.equal(exported[0][0], 0.25);
});

// 【書き出し中断と素材参照エラーを成功した音声として扱わない】
// subsystemの境界を追加してもエラーはWorker/書き出しへ伝播し、中断後の追加PCMを送信しない。
test('propagates source errors and stops exporting after cancellation', { timeout: 10000 }, async () => {
	const settings = fixture();
	const failed = { ...settings, assets: [] };
	const packet = await startPlayback(failed, 150).pull();
	assert.deepEqual(packet, { type: 'error', message: 'Audio asset not found: sound' });
	await assert.rejects(exportAudio(failed, 150, 550), /Audio asset not found: sound/);
	const exporter = new TimelineAudioExport(settings.assets, settings.clips, { positionMs: 150, endTimeMs: 550 });
	const controller = new AbortController();
	let packets = 0;
	try {
		await assert.rejects(exporter.renderUntil(0.4, async () => {
			packets++;
			controller.abort();
		}, controller.signal), { name: 'AbortError' });
		assert.equal(packets, 1);
	} finally { exporter.dispose(); }
});
