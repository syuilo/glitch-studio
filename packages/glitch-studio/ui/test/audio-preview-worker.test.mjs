import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/audio/audio-preview.worker.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'audio-monitor-platform', setup(build) {
		build.onResolve({ filter: /audio-history\.ts$|audio-spectrogram\.ts$|audio-preview-(?:spectrum|waveform)\.ts$/ }, args => ({ path: args.path, namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, () => ({ contents: `
			export class AudioHistory { reset() {} }
			export const createAudioSpectrogram = () => monitor;
			export const createPreviewSpectrum = () => monitor;
			export const createPreviewWaveform = () => monitor;
		` }));
	} }],
});

function fixture() {
	const frames = new Map();
	const messages = [];
	const renders = [];
	let nextFrameId = 0;
	let submissions = 0;
	let disposed = 0;
	const device = {
		limits: { maxTextureDimension2D: 8192 }, lost: new Promise(() => {}),
		addEventListener() {}, createShaderModule() { return {}; },
		queue: { submit() { submissions++; } },
		createCommandEncoder() { return { beginRenderPass: () => ({ end() {} }), finish: () => ({}) }; },
	};
	class GPUCanvasContext {
		configure() {} unconfigure() {}
		getCurrentTexture() { return { createView() { return {}; } }; }
	}
	const self = {
		postMessage(message) { messages.push(message); },
		requestAnimationFrame(callback) { frames.set(++nextFrameId, callback); return nextFrameId; },
		cancelAnimationFrame(id) { frames.delete(id); },
	};
	const context = {
		self, onmessage: null, setInterval() {}, GPUCanvasContext,
		navigator: { gpu: { async requestAdapter() { return { async requestDevice() { return device; } }; }, getPreferredCanvasFormat: () => 'bgra8unorm' } },
		monitor: { render(...args) { renders.push(args); }, dispose() { disposed++; } },
	};
	runInNewContext(bundled.outputFiles[0].text, context);
	return {
		frames, messages, renders, get submissions() { return submissions; }, get disposed() { return disposed; },
		canvas: { width: 1, height: 1, getContext: () => new GPUCanvasContext() },
		send: data => context.onmessage({ data }),
		draw() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); },
	};
}

// 【休止と全パネル非表示ではGPU描画も次フレームの予約も止め、同じパネルで復帰する】
// 音声が停止しているだけではモニターは描画を続ける。書き出し中にGPU処理が残らず、
// 設定変更・表示先変更を挟んでもCanvasや解析器を再生成せず一つのループで再開することを検証する。
test('suspends and resumes rendering without recreating panels or duplicating animation loops', async () => {
	const f = fixture();
	f.send({ type: 'add', id: 1, canvas: f.canvas, options: { mode: 'waveform', settings: { overlay: false, waveformSeconds: 0.04 } } });
	f.send({ type: 'resize', id: 1, width: 320, height: 180, ratio: 1, visible: true });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.frames.size, 1);
	f.draw();
	assert.equal(f.submissions, 1);
	f.send({ type: 'renderingSuspended', suspended: true, requestId: 10 });
	assert.equal(f.frames.size, 0);
	assert.equal(f.messages.at(-1).requestId, 10);
	f.send({ type: 'options', id: 1, options: { mode: 'waveform', settings: { overlay: true, waveformSeconds: 0.1 } } });
	f.send({ type: 'resize', id: 1, width: 640, height: 360, ratio: 2, visible: true });
	assert.equal(f.frames.size, 0);
	assert.equal(f.disposed, 0);
	f.send({ type: 'renderingSuspended', suspended: false, requestId: 11 });
	f.send({ type: 'renderingSuspended', suspended: false, requestId: 12 });
	assert.equal(f.frames.size, 1);
	f.draw();
	assert.equal(f.submissions, 2);
	assert.equal(f.canvas.width, 1280);
	assert.equal(f.renders.at(-1)[1].overlay, true);
	f.send({ type: 'resize', id: 1, width: 640, height: 360, ratio: 2, visible: false });
	assert.equal(f.frames.size, 0);
	f.send({ type: 'remove', id: 1 });
	assert.equal(f.disposed, 1);
});
