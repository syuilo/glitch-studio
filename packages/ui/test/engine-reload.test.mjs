import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { ref, shallowReactive } from 'vue';

const source = readFileSync(new URL('../src/engine.ts', import.meta.url), 'utf8');

function setup() {
	const workers = [];
	class Video { paused = true; currentTime = 12; }
	class Frame {
		closed = false;
		constructor(media) { this.media = media; }
		close() { this.closed = true; }
	}
	class Canvas {
		width = 300;
		height = 150;
		style = {};
		transferred = false;
		transferControlToOffscreen() {
			assert.equal(this.transferred, false, 'a canvas can only be transferred once');
			this.transferred = true;
			return {};
		}
		cloneNode() { return Object.assign(new Canvas(), { width: this.width, height: this.height, style: { ...this.style } }); }
		replaceWith(canvas) { if (this.parent) { this.parent.canvas = canvas; canvas.parent = this.parent; } }
	}
	class Worker {
		messages = [];
		terminated = false;
		postMessage(message) { assert.equal(this.terminated, false); this.messages.push(message); }
		terminate() { this.terminated = true; }
		ready() { this.onmessage?.({ data: { type: 'inited' } }); }
	}
	const exports = {};
	const dependencies = {
		vue: { ref, shallowReactive },
		'@glitch/renderer/client.ts': { createRendererWorker: () => { const worker = new Worker(); workers.push(worker); return worker; } },
		'@glitch/shared/utility/deep-equal.ts': { deepEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
		'@glitch/shared/utility/deep-clone.ts': { deepClone: structuredClone },
		'@glitch/shared/audio.ts': { projectAudioSourceId: 'project' },
		'./utility/video.ts': { isVideoFrameAvailable: () => true },
		'./utility/webcam.ts': {},
		'./audio/audio-inputs.ts': { AudioInputs: class { reconnectRenderer() {} dispose() {} } },
		'@/ui.ts': { alert() {} },
	};
	vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ESNext } }).outputText, {
		exports, require: id => { assert.ok(id in dependencies, id); return dependencies[id]; },
		navigator: { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } },
		window: { document: { createElement: () => new Canvas() } },
		console, Promise, HTMLVideoElement: Video, VideoFrame: Frame,
	});
	return { engine: new exports.Engine({ fpsLimit: 30 }), workers, Video, Frame };
}

test('reload replaces the worker and mounted canvases, restores settings and waits for readiness', async () => {
	const { engine, workers } = setup();
	const init = engine.init({ width: 640, height: 480 });
	workers[0].ready();
	await init;
	engine.startRenderLoop();
	engine.resize({ width: 800, height: 600 });
	engine.updateMacros([{ id: 'macro' }]);
	const previous = [engine.canvas, engine.histogramCanvas, engine.waveformCanvas];
	for (const canvas of previous) canvas.parent = { canvas };
	const reload = engine.reload();
	assert.equal(workers[0].terminated, true);
	assert.equal(engine.isReady.value, false);
	assert.equal(workers.length, 2);
	for (const [index, canvas] of [engine.canvas, engine.histogramCanvas, engine.waveformCanvas].entries()) {
		assert.notEqual(canvas, previous[index]);
		assert.equal(previous[index].parent.canvas, canvas);
	}
	assert.equal(workers[1].messages[0].options.resolution.width, 800);
	assert.equal(workers[1].messages[0].options.macros[0].id, 'macro');
	workers[1].ready();
	await reload;
	assert.equal(engine.isReady.value, true);
	assert.ok(workers[1].messages.some(message => message.fn === 'startRenderLoop'));
	engine.stopRenderLoop();
	const nextReload = engine.reload();
	workers[2].ready();
	await nextReload;
	assert.ok(!workers[2].messages.some(message => message.fn === 'startRenderLoop'));
});

test('concurrent reloads share initialization and updates reach the new worker after readiness', async () => {
	const { engine, workers } = setup();
	const init = engine.init({ width: 640, height: 480 });
	workers[0].ready();
	await init;
	const reload = engine.reload();
	assert.equal(engine.reload(), reload);
	engine.changeFpsLimit(60);
	engine.updateNodes([{ id: 'new-node' }]);
	assert.equal(workers[1].messages.length, 1);
	workers[0].ready();
	assert.equal(engine.isReady.value, false, 'late messages from the old worker are ignored');
	workers[1].ready();
	await reload;
	assert.equal(workers[1].messages.find(message => message.fn === 'changeFpsLimit').args[0], 60);
	assert.equal(workers[1].messages.find(message => message.fn === 'updateNodes').args[0][0].id, 'new-node');
});

test('worker initialization failure rejects reload and allows retry', async () => {
	const { engine, workers } = setup();
	const init = engine.init({ width: 640, height: 480 });
	workers[0].ready();
	await init;
	const reload = engine.reload();
	workers[1].onerror({ message: 'GPU unavailable' });
	await assert.rejects(reload, /GPU unavailable/);
	assert.equal(engine.isReady.value, false);
	const retry = engine.reload();
	workers[2].ready();
	await retry;
	assert.equal(workers[1].terminated, true);
	assert.equal(engine.isReady.value, true);
});

test('destroy during reload rejects the pending operation and cannot be revived by late messages', async () => {
	const { engine, workers } = setup();
	const init = engine.init({ width: 640, height: 480 });
	workers[0].ready();
	await init;
	const reload = engine.reload();
	engine.destroy();
	await assert.rejects(reload, /destroyed/);
	workers[1].ready();
	assert.equal(engine.isReady.value, false);
	assert.equal(workers[1].terminated, true);
});

test('reload resends paused video without waiting for an acknowledgement from the terminated worker', async () => {
	const { engine, workers, Video, Frame } = setup();
	const init = engine.init({ width: 640, height: 480 });
	workers[0].ready();
	await init;
	const media = new Video();
	const oldFrame = new Frame(media);
	engine.videoElements.set('player', media);
	engine.pendingVideoFrames.set('player', oldFrame);
	engine.inFlightVideoFrames.set('player', 10);
	const reload = engine.reload();
	assert.equal(oldFrame.closed, true);
	workers[1].ready();
	await reload;
	const message = workers[1].messages.find(message => message.type === 'videoFrame');
	assert.equal(message.playerId, 'player');
	assert.equal(message.frame.media, media);
	assert.equal(engine.getVideoElement('player'), media);
	assert.equal(media.currentTime, 12);
	assert.equal(media.paused, true);
});
