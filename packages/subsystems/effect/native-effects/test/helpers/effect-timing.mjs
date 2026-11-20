import { createTestInputs } from './native-inputs.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const loadedEffects = new Map();

async function loadEffect(effectId) {
	if (!loadedEffects.has(effectId)) {
		loadedEffects.set(effectId, (async () => {
			// 時間の判定は実際の実装を動かし、GPUへの保存先とuniformの書き込みを観測する。
			// GPUとシェーダーだけを置き換え、時間計算やパラメータの既定値は差し替えない。
			const result = await build({
				stdin: {
					contents: `export { default as implementation } from './${effectId}/_impl_.ts'; export { default as definition } from './${effectId}/_def_.ts';`,
					resolveDir: fileURLToPath(new URL('../../src/fx/', import.meta.url)),
				},
				bundle: true, write: false, format: 'cjs', platform: 'node',
				define: {
					GPUTextureUsage: JSON.stringify({ TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2 }),
					GPUBufferUsage: JSON.stringify({ UNIFORM: 1, COPY_DST: 2 }),
					GPUShaderStage: JSON.stringify({ FRAGMENT: 1 }),
				},
				plugins: [{
					name: 'observe-effect-timing',
					setup(builder) {
						builder.onResolve({ filter: /^@gs\/shared\/gpu\/(shader-buffer)\.ts$/ }, args => ({ path: args.path, namespace: 'timing-gpu' }));
						builder.onResolve({ filter: /\.(wgsl|shader\.ts)\?(raw|shader)$/ }, args => ({ path: args.path, namespace: 'timing-shader' }));
						builder.onLoad({ filter: /.*/, namespace: 'timing-shader' }, () => ({ contents: "export default ''; export const uniforms = { uniforms: {} };" }));
						builder.onResolve({ filter: /\/shader-input\.ts$/ }, args => args.path.startsWith('.') ? { path: args.path, namespace: 'timing-fixed-input' } : null);
						builder.onLoad({ filter: /.*/, namespace: 'timing-fixed-input' }, () => ({ contents: 'export const createFixedInputBindings = () => ({layout: {}, code: "", getBindGroup: () => ({}), dispose() {}});' }));
						builder.onLoad({ filter: /shader-buffer/, namespace: 'timing-gpu' }, () => ({ contents: `
							export const createShaderBuffer = () => {
								const arrayBuffer = new ArrayBuffer(4096);
								return { arrayBuffer, set(values) { arrayBuffer.values = structuredClone(values); } };
							};
						` }));
					},
				}],
			});
			const bundledModule = { exports: {} };
			new Function('module', result.outputFiles[0].text)(bundledModule);
			return bundledModule.exports;
		})());
	}
	return loadedEffects.get(effectId);
}

export async function createEffectTimingHarness(effectId, overrides = {}) {
	const { implementation, definition } = await loadEffect(effectId);
	let uniforms = null;
	const device = {
		limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 },
		queue: { writeBuffer: (_buffer, _offset, data) => { uniforms = data.values; } },
		createTexture: descriptor => ({
			width: descriptor.size.width ?? descriptor.size[0], height: descriptor.size.height ?? descriptor.size[1],
			depthOrArrayLayers: descriptor.size.depthOrArrayLayers ?? descriptor.size[2] ?? 1,
			createView(options = {}) { return { texture: this, ...options }; },
			destroy() {},
		}),
		createBuffer: () => ({ destroy() {} }),
		createPipelineLayout: () => ({}), createSampler: () => ({}), createBindGroupLayout: () => ({}), createBindGroup: () => ({}),
		createShaderModule: () => ({}), createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
	};
	const resolution = { width: 64, height: 64 };
	const params = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [
		name, structuredClone(parameter.defaultValue),
	]));
	Object.assign(params, overrides);
	const texture = device.createTexture({ size: resolution });
	const renderer = await implementation.init({ device, defaultVertexShaderModule: {}, enable32bitDataTextures: false, resolution,
		inputs: createTestInputs(definition.paramDefs, () => params), outputTextures: new Map([['output', texture]]), staticSettings: {}, resources: {} }, new Map());
	const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
	let previousTime = null;
	return {
		params,
		render(timeMs, timeDeltaMs = previousTime == null ? 0 : timeMs - previousTime) {
			const capturedLayers = [];
			renderer.render({
				time: timeMs / 1000, timeDelta: timeDeltaMs, commandEncoder: { beginRenderPass(descriptor) {
					for (const { view } of descriptor.colorAttachments) {
						if (view.texture.depthOrArrayLayers > 1) capturedLayers.push(view.baseArrayLayer);
					}
					return pass;
				} },
			});
			previousTime = timeMs;
			return { capturedLayers, uniforms };
		},
		dispose: () => renderer.dispose(),
	};
}
