import { build } from 'esbuild';
import { wgslShaderEsbuildPlugin } from '@gs/shared/build/wgsl-shader.mjs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';

export async function loadNativePreparation(id, external = []) {
	const directory = fileURLToPath(new URL('../../src/fx/' + id + '/', import.meta.url));
	const bundle = await build({ stdin: { resolveDir: directory, contents: "export {default as definition} from './_def_.ts'; export {default as implementation} from './_impl_.ts'" },
		plugins: [wgslShaderEsbuildPlugin(), { name: 'preparation-dependencies', setup(builder) {
			builder.onResolve({ filter: /.*/ }, args => external.includes(args.path) ? { path: args.path, external: true } : null);
		} }], platform: 'node', loader: { '.wgsl': 'text', '.png': 'dataurl' }, bundle: true, format: 'cjs', write: false });
	return (mocks = {}) => {
		const module = { exports: {} };
		const require = createRequire(import.meta.url);
		new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(module, module.exports, name => mocks[name] ?? require(name));
		return module.exports;
	};
}

// 実デバイス固有の描画は画素比較のスイートで扱い、ここでは確保・解放と非同期要求の完了順を観測する。
export function preparationGpu() {
	globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2, COPY_DST: 4 };
	globalThis.GPUBufferUsage = { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 };
	globalThis.GPUShaderStage = { FRAGMENT: 1, VERTEX: 2 };
	const allocations = [];
	function resource(extra) {
		const result = { destroyed: 0, destroy() { this.destroyed++; }, ...extra };
		allocations.push(result);
		return result;
	}
	const device = { limits: { maxTextureDimension2D: 8192, maxTextureDimension3D: 2048 }, features: new Set(),
		createTexture: ({ size, format }) => resource({ width: size.width ?? size[0], height: size.height ?? size[1], format, createView: () => ({}) }),
		createBuffer: descriptor => resource({ ...descriptor }), createSampler: () => ({}), createBindGroup: () => ({}),
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }), createPipelineLayout: () => ({}),
		createBindGroupLayout: () => ({}), createShaderModule: () => ({}), queue: { writeBuffer() {}, writeTexture() {} } };
	return { gpu: { device, defaultVertexShaderModule: {}, enable32bitDataTextures: false }, allocations };
}

export function createPreparationInstance(native, gpu, options = {}, signal) {
	return createEffectInstance({ effectSource: { type: 'nativeEffect', id: 'subject' }, definitions: { getNativeEffect: () => native.definition },
		resolution: { width: 8, height: 8 }, usedOutputPorts: new Set(['output']), ...options }, gpu, () => native.implementation, signal);
}
