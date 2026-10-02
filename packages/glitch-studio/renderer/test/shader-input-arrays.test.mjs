import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

globalThis.GPUShaderStage = { FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage = { UNIFORM: 64, COPY_DST: 8 };
const load = path => loadShaderSource(fileURLToPath(new URL(path, import.meta.url)));
const { constantShaderInput, textureShaderInput, generateShaderInputs, createShaderInputBindings } = await load('../../shared/src/shader-input.ts');
const { createShaderInputPipeline } = await load('../../shared/src/shader-input-pipeline.ts');
const color = value => constantShaderInput('color', value);
const red = color([1, 0, 0, 0.5]);
const texture = { width: 200, height: 100, createView() { return { texture: this }; } };
const output = { width: 100, height: 100 };

function fixture() {
	const calls = { pipelines: [], buffers: [], writes: [], samplers: [] };
	const device = {
		limits: { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxUniformBufferBindingSize: 65536, maxBindingsPerBindGroup: 640 },
		createBindGroupLayout: options => options,
		createPipelineLayout: options => options,
		createShaderModule: options => options,
		createRenderPipeline(options) { calls.pipelines.push(options); return options; },
		createBuffer(options) { const buffer = { ...options, destroyed: false, destroy() { this.destroyed = true; } }; calls.buffers.push(buffer); return buffer; },
		createSampler(options) { calls.samplers.push(options); return options; },
		createBindGroup: options => options,
		queue: { writeBuffer(buffer, offset, values) { calls.writes.push(Array.from(values)); } },
	};
	return { device, calls };
}

// 配列要素ごとの定数・fit・wrap・filterを、固定入力と混在させても正しくアップロードする。
test('uploads mixed array elements and independent sampling settings', () => {
	const { device, calls } = fixture();
	const schema = { images: { array: 'color' }, amount: 'scalar' };
	const inputs = { images: [red, textureShaderInput(texture, { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' })], amount: constantShaderInput('scalar', 0.75) };
	const bindings = createShaderInputBindings(device, generateShaderInputs(schema, inputs));
	const first = bindings.update(inputs, output);
	assert.deepEqual(calls.writes.at(-1).slice(0, 4), [0.5, 0, 0, 0.5]);
	assert.deepEqual(calls.writes.at(-1).slice(12, 16), [1, 2, 1, 1]);
	assert.equal(calls.writes.at(-1)[16], 0.75);
	assert.equal(first.entries.length, 3);
	assert.equal(calls.samplers[0].magFilter, 'nearest');
	inputs.images[1] = textureShaderInput(texture, { fitMode: 'cover', wrapMode: 'repeat', filterMode: 'linear' });
	assert.notEqual(bindings.update(inputs, output), first);
	assert.deepEqual(calls.writes.at(-1).slice(12, 16), [0.5, 1, 0, 0]);
	assert.equal(calls.samplers.at(-1).addressModeU, 'repeat');
	assert.throws(() => bindings.update({ ...inputs, images: [] }, output), /shape or kind changed/);
	bindings.dispose();
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 配列長・種別を構成に含め、値や並べ替えだけでは不要な再コンパイルを行わない。
test('caches array lengths and kinds including empty arrays', () => {
	const { device, calls } = fixture();
	const pipeline = createShaderInputPipeline({ device, vertex: {}, code: '', schema: { images: { array: 'color' } }, targets: [] });
	const first = pipeline.update({ images: [red] }, output);
	assert.equal(pipeline.update({ images: [color([0, 1, 0, 1])] }, output).pipeline, first.pipeline);
	pipeline.update({ images: [red, red] }, output);
	pipeline.update({ images: [textureShaderInput(texture, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' })] }, output);
	const empty = pipeline.update({ images: [] }, output);
	assert.ok(calls.buffers.at(-1).size > 0);
	assert.equal(empty.bindGroup.entries.length, 1);
	assert.equal(pipeline.update({ images: [red] }, output).pipeline, first.pipeline);
	assert.equal(calls.pipelines.length, 4);
	// 長さの多様な配列でもLRU上限を守り、退避した入力bufferを破棄する。
	for (let length = 2; length <= 20; length++) pipeline.update({ images: Array(length).fill(red) }, output);
	assert.ok(calls.buffers.filter(buffer => !buffer.destroyed).length <= 16);
	pipeline.dispose();
	assert.ok(calls.buffers.every(buffer => buffer.destroyed));
});

// 配列専用の選択関数と微分関数を生成し、形状不一致や内部名衝突を見逃さない。
test('generates typed selectors and rejects mismatched array shapes', () => {
	const schema = { fields: { array: 'scalar' }, vectors: { array: 'vector' }, data: { array: 'any' }, gs_element0: 'scalar' };
	const inputs = { fields: [constantShaderInput('scalar', 1)], vectors: [], data: [], gs_element0: constantShaderInput('scalar', 0) };
	const generated = generateShaderInputs(schema, inputs, 1, 'level0', true);
	assert.match(generated.code, /fn read_fields\(index: u32, position: vec2f\) -> f32/);
	assert.match(generated.code, /fn readGradient_fields\(index: u32, position: vec2f, calculate: bool\) -> vec3f/);
	assert.match(generated.code, /const count_vectors: u32 = 0u/);
	assert.equal(new Set(generated.slots.map(slot => slot.name)).size, generated.slots.length);
	assert.throws(() => generateShaderInputs({ images: { array: 'color' } }, { images: red }), /shape mismatch/);
	assert.throws(() => generateShaderInputs({ images: 'color' }, { images: [red] }), /shape mismatch/);
});

// samplerの共有オブジェクトでもbinding枠は消費する。上限超過はGPUリソース作成前に知らせる。
test('rejects texture and uniform binding limits before allocation', () => {
	const { device, calls } = fixture();
	const schema = { images: { array: 'color' } };
	const generated = generateShaderInputs(schema, { images: Array(17).fill(textureShaderInput(texture, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' })) });
	assert.throws(() => createShaderInputBindings(device, generated), /binding limits/);
	assert.equal(calls.buffers.length, 0);
	device.limits.maxUniformBufferBindingSize = 32;
	assert.throws(() => createShaderInputBindings(device, generateShaderInputs(schema, { images: [red, red] })), /binding limits/);
});
