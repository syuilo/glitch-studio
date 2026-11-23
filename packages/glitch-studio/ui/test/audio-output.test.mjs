import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/audio/audio-output.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	plugins: [{ name: 'browser-audio', setup(build) {
		build.onResolve({ filter: /audio-preview\.ts$|\?url$/ }, args => ({ path: args.path, namespace: 'audio-platform' }));
		build.onLoad({ filter: /.*/, namespace: 'audio-platform' }, () => ({ contents: `
			export default 'worklet.js';
			export class AudioPreview {
				attachAudio() {} resetAudio() {} setRunning() {} dispose() {}
				attachMeter() { return () => {}; }
			}
		` }));
	} }],
});

function setup(prepare = async () => {}) {
	const contexts = [];
	const gains = [];
	class Node {
		connections = new Set();
		constructor(context) { this.context = context; }
		connect(node) { this.connections.add(node); }
		disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
	}
	class Gain extends Node {
		constructor(context, options = {}) {
			super(context);
			this.gain = { value: options.gain ?? 1, cancelAndHoldAtTime() {}, linearRampToValueAtTime(value) { this.value = value; } };
			gains.push(this);
		}
	}
	class Port {
		messages = [];
		postMessage(message) { this.messages.push(message); }
		close() {}
	}
	const module = { exports: {} };
	runInNewContext(bundle.outputFiles[0].text, {
		module, require: createRequire(import.meta.url), console,
		GainNode: Gain,
		AudioWorkletNode: class extends Node { port = new Port(); },
		MessageChannel: class { port1 = new Port(); port2 = new Port(); },
		AudioContext: class extends EventTarget {
			state = 'running'; currentTime = 0; audioWorklet = { addModule: prepare };
			destination = new Node(this); closes = 0;
			constructor() { super(); contexts.push(this); }
			async resume() {}
			async close() { this.closes++; this.state = 'closed'; }
			createGain() { return new Gain(this); }
			createMediaElementSource() { return new Node(this); }
		},
	});
	return { ...module.exports, contexts, gains, Node };
}

// 【非同期の出力準備中にアプリが終了しても再接続しない】
// AudioWorkletの読み込み完了が遅れて届いても、閉じたContextで出力を作ってはいけない。
test('rejects output preparation that completes after disposal', async () => {
	const ready = Promise.withResolvers();
	const { AudioOutput, contexts, gains } = setup(() => ready.promise);
	const output = new AudioOutput();
	const pending = output.getOutput();
	output.dispose();
	ready.resolve();
	await assert.rejects(pending, /disposed/);
	assert.equal(contexts[0].closes, 1);
	assert.equal(gains.length, 0);
});

// 【フッターのメーターは試聴用ミックスを測り、音声パネルは常にライブ入力を解析する】
// 通常の再生は両方の経路に流す。ライブ入力は試聴オンのときだけフッターのメーターに加える。
// 共通のプレビュー音量をゼロにしても、メーターと音声パネルには同じ信号が届く必要がある。
test('meters the playback mix before preview volume and captures PCM from the analysis mix', async () => {
	const { AudioOutput, Node } = setup();
	const audioOutput = new AudioOutput();
	const releaseCapture = audioOutput.retainOutputCapture();
	const output = await audioOutput.getOutput();
	const { destination } = output.context;
	const analysisMix = [...output.connections].find(node => node.connections.size === 1);
	const playbackMix = [...output.connections].find(node => node !== analysisMix);
	assert.ok(analysisMix);
	assert.ok(playbackMix);
	assert.equal(analysisMix.connections.size, 1);
	const [capture] = analysisMix.connections;
	assert.deepEqual(capture.port.messages.map(message => message.type), ['connect', 'state']);
	assert.ok(capture.connections.has(destination));
	assert.equal(playbackMix.connections.size, 2);
	const meter = [...playbackMix.connections].find(node => node.port != null);
	const previewGain = [...playbackMix.connections].find(node => node !== meter);
	assert.ok(meter);
	assert.ok(previewGain);
	assert.deepEqual(meter.port.messages.map(message => message.type), ['meter', 'meterState', 'state']);
	assert.ok(meter.connections.has(destination));
	assert.ok(previewGain.connections.has(destination));

	const liveSource = new Node(output.context);
	const monitoring = audioOutput.connectLivePreviewAudio(liveSource);
	assert.ok(liveSource.connections.has(analysisMix));
	const monitoringGain = [...liveSource.connections].find(node => node !== analysisMix);
	assert.ok(monitoringGain);
	assert.deepEqual(monitoringGain.connections, new Set([playbackMix]));
	assert.equal(monitoringGain.gain.value, 0);

	monitoring.setEnabled(true);
	assert.equal(monitoringGain.gain.value, 1);
	audioOutput.setPreviewVolume(0);
	assert.equal(previewGain.gain.value, 0);
	assert.equal(playbackMix.gain.value, 1);
	monitoring.setEnabled(false);
	assert.equal(monitoringGain.gain.value, 0);
	assert.equal(analysisMix.gain.value, 1);
	assert.ok(liveSource.connections.has(analysisMix));

	monitoring.dispose();
	assert.equal(liveSource.connections.size, 0);
	assert.equal(monitoringGain.connections.size, 0);
	assert.deepEqual(output.connections, new Set([analysisMix, playbackMix]));
	releaseCapture();
	assert.equal(analysisMix.connections.size, 0);
	assert.deepEqual(playbackMix.connections, new Set([previewGain]));
	await audioOutput.dispose();
});
