import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomShaderEffectInstance } from '../src/custom-shader-effect/create-custom-shader-effect-instance.ts';

globalThis.GPUShaderStage ??= { FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUBufferUsage ??= { COPY_DST: 8, UNIFORM: 64 };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 };

const definition = {
	code: 'fn main(p: vec2f) -> Output { return Output(read_source(p), read_gain(p)); }',
	paramDefs: [
		{ id: 'in-0', nameForReference: 'source', dataType: { kind: 'color' } },
		{ id: 'in-1', nameForReference: 'gain', dataType: { kind: 'scalar' } },
	],
	outputDefs: [
		{ id: 'out-0', nameForReference: 'color', dataType: { kind: 'color' } },
		{ id: 'out-1', nameForReference: 'gain', dataType: { kind: 'scalar' } },
	],
};

function createDevice(messages = []) {
	const calls = { modules: [], pipelines: [], textures: [], groups: [], writes: [], passes: [], buffersDestroyed: 0 };
	const device = {
		limits: { maxColorAttachments: 1 },
		queue: { writeBuffer: (_buffer, _offset, values) => calls.writes.push(Array.from(values)) },
		createBuffer: () => ({ destroy: () => { calls.buffersDestroyed++; } }),
		createSampler: () => ({}),
		createBindGroupLayout: descriptor => descriptor,
		createBindGroup: descriptor => { calls.groups.push(descriptor.entries.map(entry => entry.resource)); return {}; },
		pushErrorScope() {},
		popErrorScope: async () => null,
		createShaderModule: ({ code }) => { calls.modules.push(code); return { getCompilationInfo: async () => ({ messages }) }; },
		createPipelineLayout: descriptor => descriptor,
		createRenderPipelineAsync: async descriptor => { calls.pipelines.push(descriptor); return {}; },
		createTexture: descriptor => {
			const texture = { ...descriptor, createView: () => ({}), destroy() { this.destroyed = true; } };
			calls.textures.push(texture);
			return texture;
		},
	};
	const encoder = {
		beginRenderPass(descriptor) {
			calls.passes.push(descriptor);
			return { setPipeline() {}, setBindGroup() {}, draw(count) { assert.equal(count, 3); }, end() {} };
		},
	};
	const resolution = { width: 2, height: 2 };
	const options = {
		gpu: { device, defaultVertexShaderModule: {}, enable32bitDataTextures: true },
		usedOutputPorts: new Set(['out-1']),
		resolution,
		inputs: {
			'in-0': { kind: 'texture', read: frame => ({ kind: 'texture', texture: frame.texture }),
				resolution: { width: 4, height: 2 }, sampling: { fitMode: 'cover', filterMode: 'nearest', wrapMode: 'transparent' } },
			'in-1': { kind: 'uniform', read: frame => ({ kind: 'uniform', value: [frame.gain] }) },
		},
	};
	return { options, calls, encoder };
}

// 【使用出力と全入力種別を初期化時に確定し、値や借用テクスチャが変わっても同じpipelineで描画する】
// 上限1出力のDeviceでも複数出力のmainをそのまま使える。uniform値の更新ではbind groupを
// 作り直さず、実際のテクスチャが差し替わった際だけ対応するbindingを更新する。
test('compiles only requested targets once and rebinds only changed texture handles', async () => {
	const { options, calls, encoder } = createDevice();
	const instance = await createCustomShaderEffectInstance(definition, options);
	const firstTexture = { createView: () => ({ texture: 'first' }) };
	const secondTexture = { createView: () => ({ texture: 'second' }) };
	for (const [texture, gain] of [[firstTexture, 3], [firstTexture, 4], [secondTexture, 4], [secondTexture, 5]]) {
		instance.render({ commandEncoder: encoder, texture, gain });
	}
	assert.deepEqual(Object.keys(instance.outputs), ['out-1']);
	assert.equal(calls.modules.length, 1);
	assert.ok(calls.modules[0].startsWith(definition.code));
	assert.match(calls.modules[0], /struct Output \{\s+color: vec4f,\s+gain: f32,/);
	assert.match(calls.modules[0], /return GsFragmentOutput\(output.gain\)/);
	assert.deepEqual(calls.pipelines.map(pipeline => pipeline.fragment.targets), [[{ format: 'r32float' }]]);
	assert.equal(calls.textures.length, 1);
	assert.equal(instance.outputs['out-1'].read().texture, calls.textures[0]);
	assert.deepEqual(calls.writes.map(values => values[8]), [3, 4, 5]);
	assert.deepEqual(calls.writes[0].slice(4, 8), [0.5, 1, 1, 1]);
	assert.equal(calls.groups.length, 2);
	assert.equal(calls.passes.length, 4);
	assert.equal(calls.passes[0], calls.passes[3]);
	instance.dispose();
	assert.equal(calls.textures[0].destroyed, true);
	assert.equal(calls.buffersDestroyed, 1);
});

// 【入力の種類が確定していない配置はGPUリソースを作る前に拒否する】
// フレームの値からパイプラインを選び直す必要がないよう、全入力の契約を初期化時に確定させる。
test('requires uniform or texture bindings before creating GPU resources', async () => {
	const { options, calls } = createDevice();
	options.inputs['in-1'] = { kind: 'value', read: () => 1 };
	await assert.rejects(createCustomShaderEffectInstance(definition, options), /in-1 requires a fixed uniform or texture/);
	assert.equal(calls.modules.length, 0);
	assert.equal(calls.textures.length, 0);
});

// 【入力のない生成用Custom Shader Effectでは空の入力バッファやbind groupを確保しない】
// 出力だけを使うWGSLではフレームごとに入力を更新する処理も不要になる。
test('renders generators without an input bind group or uniform upload', async () => {
	const { options, calls, encoder } = createDevice();
	const generator = { ...definition, paramDefs: [], code: 'fn main(p: vec2f) -> Output { return Output(vec4f(0.0), p.x); }' };
	const instance = await createCustomShaderEffectInstance(generator, options);
	instance.render({ commandEncoder: encoder });
	assert.deepEqual(calls.pipelines[0].layout.bindGroupLayouts, []);
	assert.equal(calls.groups.length, 0);
	assert.equal(calls.writes.length, 0);
	instance.dispose();
	assert.equal(calls.buffersDestroyed, 0);
});

// 【WGSLの失敗時は本文の位置を返し、作成途中のGPUリソースを解放する】
// ユーザーが編集中のWGSLでは構文エラーが普通に起きる。出力の確保と実行開始はコンパイル成功後に限る。
test('keeps user diagnostics and releases allocation on compilation failure', async () => {
	const { options, calls } = createDevice([{ type: 'error', lineNum: 1, linePos: 6, offset: 5, message: 'invalid shader' }]);
	await assert.rejects(createCustomShaderEffectInstance(definition, options), /1:6: invalid shader/);
	assert.equal(calls.buffersDestroyed, 1);
	assert.equal(calls.textures.length, 0);
});
