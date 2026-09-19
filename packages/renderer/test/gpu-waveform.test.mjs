import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.GPUQueue = class {
	submit() {}
};
globalThis.GPUBufferUsage = {
	COPY_DST: 1,
	STORAGE: 2,
	UNIFORM: 4,
};

globalThis.GPUTextureUsage = {
	RENDER_ATTACHMENT: 1,
};
globalThis.GPUShaderStage = {
	COMPUTE: 1,
	FRAGMENT: 2,
};

test('waveform sampling caps the longest edge at 1024 pixels', async () => {
	const server = await createServer({
		root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false },
		appType: 'custom',
	});

	try {
		const { fitWaveformSampleSize } = await server.ssrLoadModule('/src/utility/waveform/GpuWaveform.ts');

		assert.deepEqual(fitWaveformSampleSize(640, 480), { width: 640, height: 480 });
		assert.deepEqual(fitWaveformSampleSize(4096, 2048), { width: 1024, height: 512 });
		assert.deepEqual(fitWaveformSampleSize(2048, 4096), { width: 512, height: 1024 });
	} finally {
		await server.close();
	}
});

test('GPU waveform downsamples a large source and draws it in the same frame', async () => {
	const server = await createServer({
		root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false },
		appType: 'custom',
	});

	try {
		const { GpuWaveform } = await server.ssrLoadModule('/src/utility/waveform/GpuWaveform.ts');
		const calls = {
			configure: [],
			writeBuffer: [],
			clearBuffer: [],
			dispatchWorkgroups: [],
			draw: [],
		};
		const buffers = [];
		const context = {
			configure(configuration) {
				calls.configure.push(configuration);
			},
			getCurrentTexture() {
				return { createView: () => 'waveform-target-view' };
			},
			unconfigure() {},
		};
		const device = {
			createSampler: () => ({}),
			limits: { maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, maxComputeWorkgroupsPerDimension: 65535 },
			queue: {
				writeBuffer(buffer, offset, data) {
					calls.writeBuffer.push([buffer, offset, Array.from(new Uint32Array(data))]);
				},
			},
			createBuffer(descriptor) {
				const buffer = {
					descriptor,
					destroyed: false,
					destroy() {
						this.destroyed = true;
					},
				};
				buffers.push(buffer);
				return buffer;
			},
			createBindGroupLayout(descriptor) { return { descriptor }; },
			createPipelineLayout(descriptor) { return { descriptor }; },
			createShaderModule(descriptor) { return { descriptor }; },
			createComputePipeline(descriptor) { return { descriptor }; },
			createRenderPipeline(descriptor) { return { descriptor, getBindGroupLayout: () => ({}) }; },
			createBindGroup(descriptor) { return { descriptor }; },
		};
		const computePass = {
			setPipeline() {},
			setBindGroup() {},
			dispatchWorkgroups(...args) {
				calls.dispatchWorkgroups.push(args);
			},
			end() {},
		};
		const renderPass = {
			setPipeline() {},
			setBindGroup() {},
			draw(...args) {
				calls.draw.push(args);
			},
			end() {},
		};
		const commandEncoder = {
			clearBuffer(...args) {
				calls.clearBuffer.push(args);
			},
			beginComputePass() {
				return computePass;
			},
			beginRenderPass() {
				return renderPass;
			},
		};
		const sourceTexture = {
			width: 4096,
			height: 2048,
			createView: () => 'source-view',
		};

		const waveform = new GpuWaveform(device, context, 'bgra8unorm');
		waveform.render(commandEncoder, sourceTexture);

		assert.equal(calls.configure.length, 1);
		assert.deepEqual(calls.writeBuffer.map(([, offset, data]) => [offset, data]), [
			[0, [0, new Uint32Array(new Float32Array([0.22]).buffer)[0], 512, 256, 0, 1, 1024, 512]],
		]);
		assert.deepEqual(calls.clearBuffer, [[buffers[1]]]);
		assert.deepEqual(calls.dispatchWorkgroups, [[64, 32]]);
		assert.deepEqual(calls.draw, [[6]]);

		waveform.dispose();
		assert.equal(buffers.every(buffer => buffer.destroyed), true);
	} finally {
		await server.close();
	}
});
