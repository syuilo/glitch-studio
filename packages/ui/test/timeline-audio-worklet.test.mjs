import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/audio/timeline-audio.worklet.js', import.meta.url), 'utf8');
function setup() {
	const messages = [];
	let Processor;
	const context = vm.createContext({ sampleRate: 1024, currentFrame: 0, AudioWorkletProcessor: class {
		port = { postMessage: value => messages.push(value) };
	}, registerProcessor: (_name, value) => { Processor = value; } });
	vm.runInContext(source, context);
	const processor = new Processor();
	return { processor, messages,
		push(value, frames = 256) { processor.port.onmessage({ data: { type: 'pcm', channels: [new Float32Array(frames).fill(value), new Float32Array(frames).fill(-value)] } }); },
		render() { const output = [new Float32Array(128), new Float32Array(128)]; processor.process([], [output]); context.currentFrame += 128; return output; },
	};
}

// 【先読み不足の間は音声時計を停止する】
// 無音を出しながら映像だけ進めると、復帰後の映像と音声がずれてしまう。
test('freezes playback during buffering and resumes from the unconsumed sample', () => {
	const audio = setup();
	assert.equal(audio.render()[0][0], 0);
	audio.push(0.25);
	assert.equal(audio.render()[0][0], 0.25);
	assert.equal(audio.render()[1][0], -0.25);
	assert.equal(audio.render()[0][0], 0);
	assert.equal(audio.processor.played, 256);
	assert.equal(audio.messages.filter(message => message.type === 'pull').length, 1);
	audio.push(0.75);
	assert.equal(audio.render()[0][0], 0.75);
	assert.equal(audio.processor.played, 384);
});

// 【チャンク境界で欠落や重複を発生させない】
// レイヤー境界やループ境界がAudioWorkletの処理単位と一致するとは限らない。
test('consumes adjacent chunks across quantum boundaries and disposes old queues', () => {
	const audio = setup();
	audio.push(0.25, 140);
	audio.push(0.5, 256);
	audio.render();
	const output = audio.render();
	assert.deepEqual([...output[0].slice(0, 12)], Array(12).fill(0.25));
	assert.deepEqual([...output[0].slice(12)], Array(116).fill(0.5));
	audio.processor.port.onmessage({ data: { type: 'dispose' } });
	assert.equal(audio.processor.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
	assert.equal(audio.processor.queue.length, 0);
});
