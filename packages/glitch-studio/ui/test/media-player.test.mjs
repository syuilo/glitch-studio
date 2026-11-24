import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { i18n, i18nPlugin } from './helpers/i18n.mjs';

const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/MediaPlayerController.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [i18nPlugin, { name: 'media-player-worker', setup(build) {
		build.onResolve({ filter: /^@gs\/glitch-studio_renderer\/client\.ts$/ }, () => ({ path: 'renderer', namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function createMediaPlayerRendererWorker() { throw new Error("Microphone capture does not need a render worker"); }' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'i18n', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, i18n);
const { MediaPlayerController } = module.exports;

function setupMicrophone(t, getUserMedia) {
	const property = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
	t.after(() => {
		if (property == null) delete navigator.mediaDevices;
		else Object.defineProperty(navigator, 'mediaDevices', property);
	});
	const events = [];
	const track = Object.assign(new EventTarget(), {
		readyState: 'live', getSettings: () => ({ echoCancellation: false }),
		stop: () => events.push('track stopped'),
	});
	const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
	const audioOutput = {
		getOutput: async () => ({ context: { createMediaStreamSource: source => source } }),
		connectLivePreviewAudio(source) {
			assert.equal(source, stream);
			events.push('analysis connected');
			return {
				setEnabled: enabled => events.push(`monitoring ${enabled}`),
				dispose: () => events.push('analysis disconnected'),
			};
		},
	};
	const player = new MediaPlayerController(audioOutput, () => null, () => {
		assert.fail('Microphone capture should not initialize a render worker');
	}, () => {});
	player.setSelection({ kind: 'microphone', deviceId: 'default' });
	player.syncSource(true);
	t.after(() => player.dispose());
	return { player, stream, events };
}

// 【マイクの許可応答がプレビュー切替後に届く場合】
// 許可ダイアログが遅れて完了しても、旧ソースのトラックを解放し、解析や試聴へ接続させない。
test('releases a microphone granted after leaving Media Player', async t => {
	const pending = Promise.withResolvers();
	const { player, stream, events } = setupMicrophone(t, () => pending.promise);
	const starting = player.startCapture();
	player.syncSource(false);
	pending.resolve(stream);
	await starting;
	assert.deepEqual(events, ['track stopped']);
	assert.equal(player.captureStatus.value, 'idle');
});

// 【マイク入力の解析と試聴を独立させる】
// 取得を開始した時点で解析に接続して、試聴は明示操作でのみ有効化する。停止時には両方の接続を解放する。
test('analyzes the microphone with monitoring initially disabled', async t => {
	const { player, stream, events } = setupMicrophone(t, async constraints => {
		assert.deepEqual(constraints, {
			video: false,
			audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
		});
		return stream;
	});
	await player.startCapture();
	assert.equal(player.captureStatus.value, 'live');
	assert.equal(player.monitoringEnabled.value, false);
	assert.deepEqual(events, ['analysis connected']);
	player.setMonitoringEnabled(true);
	player.stopCapture();
	assert.deepEqual(events, ['analysis connected', 'monitoring true', 'track stopped', 'analysis disconnected']);
	assert.equal(player.monitoringAvailable.value, false);
});
