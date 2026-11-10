import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const globals = ['GPUTextureUsage', 'GPUBufferUsage', 'GPUShaderStage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 1 };
globalThis.GPUBufferUsage = { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
after(() => {
	for (const [key, descriptor] of globals) {
		if (descriptor != null) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});
const { createWaveform } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/shared/utility/waveform/waveform.ts')));
const { GpuHistogram } = await loadShaderSource(fileURLToPath(new URL('../src/utility/histogram/GpuHistogram.ts', import.meta.url)));

function fixture() {
	const buffers = [];
	const pipelines = [];
	const dispatches = [];
	const device = {
		limits: { maxStorageBufferBindingSize: 128 * 1024 * 1024, maxBufferSize: 128 * 1024 * 1024, maxComputeWorkgroupsPerDimension: 65535 },
		createBuffer(options) { const buffer = { ...options, destroyed: false, destroy() { this.destroyed = true; } }; buffers.push(buffer); return buffer; },
		createBindGroupLayout: options => options, createPipelineLayout: options => options, createBindGroup: options => options,
		createShaderModule: options => options,
		createComputePipeline(options) { pipelines.push(options); return { ...options, getBindGroupLayout: () => ({}) }; },
		createRenderPipeline: options => ({ ...options, getBindGroupLayout: () => ({}) }),
		queue: { writeBuffer() {} },
	};
	function computePass() {
		let pipeline = null;
		return { setPipeline(value) { pipeline = value; }, setBindGroup() {}, dispatchWorkgroups() { dispatches.push(pipeline.compute.entryPoint); }, end() {} };
	}
	const encoder = { clearBuffer() {}, beginComputePass: computePass, beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }) };
	const storageBytes = () => buffers.filter(buffer => !buffer.destroyed && (buffer.usage & GPUBufferUsage.STORAGE) !== 0).reduce((total, buffer) => total + buffer.size, 0);
	return { device, encoder, buffers, pipelines, dispatches, computePass, storageBytes };
}

// 【通常サイズの波形は従来の一つの集計バッファと一回のdispatchだけを使う】
// High-resを使わなくても追加バッファ・結果統合が残るという性能上の問題を、確保量とGPU要求で検出する。
// 全画素数が65537を超えても、位置ビンに分散して安全なら軽い経路を維持する。
test('keeps ordinary waveforms at one count buffer and one accumulation dispatch', () => {
	const f = fixture();
	const waveform = createWaveform({ device: f.device, vertexShaderModule: {}, format: 'rgba8unorm' });
	try {
		assert.equal(waveform.prepare({ kind: 'uniform', value: [0.5, 0, 0, 1] }, { mode: 'rgb', direction: 'horizontal', intensity: 1,
			fitSize: { width: 1024, height: 1024 }, sampleSize: { width: 1024, height: 1024 }, size: { width: 512, height: 256 } }, f.encoder), true);
		waveform.accumulate(f.computePass());
		assert.equal(f.storageBytes(), 512 * 256 * 3 * 4);
		assert.deepEqual(f.dispatches, ['accumulate']);
		assert.equal(f.pipelines.length, 1);
		assert.equal(f.pipelines[0].compute.constants.usePartialSums, 0);
		const allocatedBuffers = f.buffers.length;
		waveform.prepare({ kind: 'uniform', value: [0.25, 0, 0, 1] }, { mode: 'rgb', direction: 'horizontal', intensity: 1,
			fitSize: { width: 1024, height: 1024 }, sampleSize: { width: 1024, height: 1024 }, size: { width: 512, height: 256 } }, f.encoder);
		assert.equal(f.buffers.length, allocatedBuffers);
		assert.equal(f.pipelines.length, 1);
	} finally { waveform.dispose(); }
	assert.equal(f.storageBytes(), 0);
});

for (const direction of ['horizontal', 'vertical']) {
	// 【位置ビン単位の上限を越えた場合だけ分割し、安全な経路へ戻ると追加バッファを解放する】
	// 縦波形の軸交換、上限ちょうどの値、同じ出力寸法のままサンプル数だけを変える場合も確認する。
	test(`switches waveform accumulation safely at the per-position boundary: ${direction}`, () => {
		const f = fixture();
		const waveform = createWaveform({ device: f.device, vertexShaderModule: {}, format: 'rgba8unorm' });
		const size = direction === 'horizontal' ? { width: 1, height: 256 } : { width: 256, height: 1 };
		const settings = { mode: 'vectorX', direction, intensity: 1, size, fitSize: { width: 1, height: 1 } };
		try {
			for (const count of [65537, 65538, 65537]) {
				f.dispatches.length = 0;
				const sampleSize = direction === 'horizontal' ? { width: 1, height: count } : { width: count, height: 1 };
				assert.equal(waveform.prepare({ kind: 'uniform', value: [0.5, 0, 0, 1] }, { ...settings, sampleSize }, f.encoder), true);
				waveform.accumulate(f.computePass());
				assert.deepEqual(f.dispatches, count === 65537 ? ['accumulate'] : ['accumulate', 'reduceCounts']);
				assert.equal(f.storageBytes(), 256 * 3 * 4 * (count === 65537 ? 1 : 10));
			}
		} finally { waveform.dispose(); }
		assert.equal(f.storageBytes(), 0);
	});
}

// 【ヒストグラムは通常の100×100サンプルと安全なHigh-res入力では従来経路を使う】
// High-resというモード名で無条件に分割せず、最大サンプル数で判定する。
// 分割から通常解析へ戻ったときは、元と同じテクスチャを使っていても部分和を破棄する。
test('only allocates and dispatches histogram partial sums for overflowing sample counts', () => {
	const f = fixture();
	const context = { configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
	const histogram = new GpuHistogram(f.device, context, 'rgba8unorm');
	const source = { width: 65537, height: 1, createView: () => ({}) };
	try {
		for (const [width, fullResolution, split] of [[65537, false, false], [65537, true, false], [65538, true, true], [65538, false, false], [65537, true, false]]) {
			source.width = width;
			f.dispatches.length = 0;
			histogram.render(f.encoder, source, fullResolution);
			assert.deepEqual(f.dispatches, split ? ['accumulate', 'reduceCounts', 'findMax'] : ['accumulateDirect', 'findDirectMax']);
			assert.equal(f.storageBytes(), 769 * 4 + (split ? 9 * 768 * 4 : 0));
			if (width === 65537 && f.pipelines.length === 2) assert.ok(f.pipelines.every(pipeline => pipeline.compute.entryPoint !== 'reduceCounts'));
		}
	} finally { histogram.dispose(); }
	assert.equal(f.storageBytes(), 0);
});
