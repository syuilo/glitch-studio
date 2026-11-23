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
