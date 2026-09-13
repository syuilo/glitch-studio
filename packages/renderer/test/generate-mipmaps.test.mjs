import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMipmaps, getMipLevelCount } from '../src/utility/generateMipmaps.ts';

function setup() {
	const calls = {
		bindGroups: 0,
		commandEncoders: 0,
		passes: [],
		pipelines: 0,
		queueSubmits: 0,
		samplers: 0,
		shaderModules: 0,
		views: [],
	};
	const device = {
		queue: { submit() { calls.queueSubmits++; } },
		createBindGroup(descriptor) {
			calls.bindGroups++;
			return descriptor;
		},
		createCommandEncoder() {
			calls.commandEncoders++;
			return createEncoder();
		},
		createRenderPipeline() {
			calls.pipelines++;
			return { getBindGroupLayout() { return {}; } };
		},
		createSampler() {
			calls.samplers++;
			return {};
		},
		createShaderModule() {
			calls.shaderModules++;
			return {};
		},
	};
	const texture = {
		depthOrArrayLayers: 1,
		dimension: '2d',
		format: 'rgba16float',
		height: 8,
		mipLevelCount: 4,
		width: 8,
		createView(descriptor = {}) {
			const view = { descriptor, texture: this };
			calls.views.push(view);
			return view;
		},
	};
	function createEncoder() {
		return {
			beginRenderPass(descriptor) {
				calls.passes.push(descriptor);
				return { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
			},
		};
	}
	return { calls, device, encoder: createEncoder(), texture };
}

test('records mip generation on the supplied encoder and reuses texture resources', () => {
	const { calls, device, encoder, texture } = setup();

	generateMipmaps(device, encoder, texture);
	assert.equal(calls.commandEncoders, 0, 'the utility must not create a command encoder');
	assert.equal(calls.queueSubmits, 0, 'the utility must not submit command buffers');
	assert.equal(calls.passes.length, 3);
	assert.equal(calls.views.length, 6);
	assert.equal(calls.bindGroups, 3);
	assert.equal(calls.pipelines, 1);
	assert.equal(calls.samplers, 1);
	assert.equal(calls.shaderModules, 1);

	generateMipmaps(device, encoder, texture);
	assert.equal(calls.passes.length, 6, 'generation is recorded again for updated texels');
	assert.equal(calls.views.length, 6, 'mip views are cached per texture');
	assert.equal(calls.bindGroups, 3, 'bind groups are cached per texture');
	assert.equal(calls.pipelines, 1, 'the format pipeline is cached per device');
	assert.equal(calls.samplers, 1, 'the sampler is cached per device');
	assert.equal(calls.shaderModules, 1, 'the shader module is cached per device');
});

test('does nothing for a single-level texture', () => {
	const { calls, device, encoder, texture } = setup();
	texture.mipLevelCount = 1;
	generateMipmaps(device, encoder, texture);
	assert.equal(calls.passes.length, 0);
	assert.equal(calls.shaderModules, 0);
});

test('calculates a complete two-dimensional mip chain', () => {
	assert.equal(getMipLevelCount(1, 1), 1);
	assert.equal(getMipLevelCount(64, 32), 7);
	assert.equal(getMipLevelCount(1920, 1080), 11);
});
