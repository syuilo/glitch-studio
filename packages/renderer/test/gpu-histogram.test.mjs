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
};
globalThis.GPUTextureUsage = {
	RENDER_ATTACHMENT: 1,
};
globalThis.GPUShaderStage = {
	COMPUTE: 1,
	VERTEX: 2,
	FRAGMENT: 4,
};

test('GPU histogram encodes accumulation, normalization, and drawing every frame', async () => {
	const server = await createServer({
		root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
		server: { middlewareMode: true, hmr: false },
		appType: 'custom',
	});

	try {
		const { GpuHistogram } = await server.ssrLoadModule('/src/utility/histogram/GpuHistogram.ts');
		const calls = {
			configure: [],
			clearBuffer: [],
			dispatchWorkgroups: [],
			draw: [],
		};
		const histogramBuffer = {
			destroyed: false,
			destroy() {
				this.destroyed = true;
			},
		};
		const context = {
			configure(configuration) {
				calls.configure.push(configuration);
			},
			getCurrentTexture() {
				return { createView: () => 'histogram-target-view' };
			},
			unconfigure() {},
		};
		const device = {
			createBuffer() {
				return histogramBuffer;
			},
			createBindGroupLayout(descriptor) {
				return { descriptor };
			},
			createPipelineLayout(descriptor) {
				return { descriptor };
			},
			createShaderModule(descriptor) {
				return { descriptor };
			},
			createComputePipeline(descriptor) {
				return { descriptor };
			},
			createRenderPipeline(descriptor) {
				return { descriptor };
			},
			createBindGroup(descriptor) {
				return { descriptor };
			},
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
			createView: () => 'source-view',
		};

		const histogram = new GpuHistogram(device, context, 'bgra8unorm');
		histogram.render(commandEncoder, sourceTexture);

		assert.equal(calls.configure.length, 1);
		assert.equal(calls.configure[0].device, device);
		assert.deepEqual(calls.clearBuffer, [[histogramBuffer]]);
		assert.deepEqual(calls.dispatchWorkgroups, [[10, 10], [1]]);
		assert.deepEqual(calls.draw, [[6, 14], [6, 768]]);

		histogram.dispose();
		assert.equal(histogramBuffer.destroyed, true);
	} finally {
		await server.close();
	}
});
