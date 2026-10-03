import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/pcm-resampler.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { PcmResampler } = module.exports;

function tone(rate, frequency, frames = rate / 5) {
	const left = Float32Array.from({ length: frames }, (_, frame) => 0.5 * Math.sin(2 * Math.PI * frequency * frame / rate));
	return { time: 0, rate, channels: [left, left.map(value => -value)] };
}

function rms(samples) {
	return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

// 【間引きで帯域外の音を可聴域に折り返さない】
// 96kHzの30kHz成分を48kHzへ変換すると、帯域制限がなければ18kHzとして残る。
// 一方で通常の可聴成分や左右の独立性を失ってはいけない。
test('rejects out-of-band tones while preserving passband gain and stereo', () => {
	const resampler = new PcmResampler();
	const rejected = resampler.resample([tone(96000, 30000)], 0.02, 4800, 48000);
	assert.ok(rms(rejected[0]) < 0.0001);
	const passed = resampler.resample([tone(96000, 1000)], 0.02, 4800, 48000);
	assert.ok(Math.abs(rms(passed[0]) - 0.5 / Math.sqrt(2)) < 0.001);
	assert.deepEqual(passed[1], passed[0].map(value => -value));
});

// 【分割デコード・先読み窓・シークで同じサンプルを生成する】
// プレビューと書き出しは読み取り単位が異なるため、フィルターの位相や履歴を
// 呼び出し順に依存させず、前後のPCMが同じなら同じ結果を返す必要がある。
test('keeps resampling continuous across decoded blocks, chunks and random seeks', () => {
	for (const [inputRate, outputRate] of [[44100, 48000], [48000, 44100], [96000, 48000]]) {
		const source = tone(inputRate, 7000);
		const blocks = [];
		for (let start = 0; start < source.channels[0].length; start += 997) {
			blocks.push({ time: start / inputRate, rate: inputRate, channels: source.channels.map(channel => channel.slice(start, start + 997)) });
		}
		const resampler = new PcmResampler();
		const time = 0.031;
		const whole = resampler.resample([source], time, 3000, outputRate);
		const split = [new Float32Array(3000), new Float32Array(3000)];
		// 後半を先に読み、以前の呼び出しのフィルター状態が混入しないことも確認する。
		for (const [offset, frames] of [[137, 2863], [0, 137]]) {
			const part = resampler.resample(blocks, time + offset / outputRate, frames, outputRate);
			split.forEach((channel, i) => channel.set(part[i], offset));
		}
		for (let i = 0; i < 3000; i++) assert.ok(Math.abs(whole[0][i] - split[0][i]) < 0.00001, `${inputRate}/${outputRate}: ${i}`);
	}
});

// 【同じレートでは元のPCMを保ち、素材外を無音にする】
// 不要なローパスで音を変えず、空の素材や素材の前後からNaNを生成しない。
test('passes aligned PCM unchanged and returns silence outside the source', () => {
	const source = tone(48000, 15000);
	const resampler = new PcmResampler();
	const output = resampler.resample([source], 0.01, 1000, 48000);
	assert.deepEqual(output[0], source.channels[0].slice(480, 1480));
	assert.ok(resampler.resample([], 0, 100, 48000)[0].every(value => value === 0));
	assert.ok(resampler.resample([source], 1, 100, 48000)[0].every(value => value === 0));
});
