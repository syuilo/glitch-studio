import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
	stdin: { contents: "export { AudioOutput } from './audio-output.ts'; export { AudioInputs } from './audio-inputs.ts';", resolveDir: fileURLToPath(new URL('../src/audio', import.meta.url)), loader: 'ts' },
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
	class Port { postMessage() {} close() {} }
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

// 【Player入力の破棄でタイムラインが借りている出力を閉じない】
// 映像側のコントローラーはAudioInputsだけを所有する。試聴音量とAudioContextは
// アプリが所有し、Playerの切断・再接続に関係なくタイムラインから使い続けられる。
test('keeps the shared output and preview volume alive after disposing player inputs', async () => {
	const { AudioOutput, AudioInputs, contexts, gains, Node } = setup();
	const output = new AudioOutput();
	const inputs = new AudioInputs(output, () => {}, () => {});
	const release = output.retainOutputCapture();
	const bus = await output.getOutput();
	const timeline = new Node(bus.context);
	timeline.connect(bus);
	const media = new class extends EventTarget {
		volume = 0.7; muted = false; paused = true;
		async play() { this.paused = false; }
		pause() { this.paused = true; }
	}();
	inputs.registerPlayer('player', media);
	await inputs.play('player');
	output.setPreviewVolume(0.2);
	inputs.reconnectRenderer();
	inputs.dispose();
	assert.equal(media.paused, true);
	assert.equal(contexts.length, 1);
	assert.equal(contexts[0].closes, 0);
	assert.equal(await output.getOutput(), bus);
	assert.equal(timeline.connections.has(bus), true);
	assert.equal(gains[1].gain.value, 0.2);
	timeline.disconnect();
	release();
	output.dispose();
	assert.equal(contexts[0].closes, 1);
});

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
