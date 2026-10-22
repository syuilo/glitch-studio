import definition from '../../src/fx/lightTracing2d/_def_.ts';
import implementation from '../../src/fx/lightTracing2d/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const owned: { destroy(): void }[] = [];
	const effects: { dispose(): void }[] = [];
	const vertex = device.createShaderModule({ code: vertexCode });
	const readModule = device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn read(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` });
	const readPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: { module: readModule, targets: [{ format: 'rgba8unorm' }] } });
	async function validate() {
		const error = await device.popErrorScope();
		device.pushErrorScope('validation');
		if (error != null) throw new Error(error.message);
	}
	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(readPipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout: readPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(6);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Uint8Array(buffer.getMappedRange());
			const pixels = new Uint8ClampedArray(width * height * 4);
			for (let y = 0; y < height; y++) pixels.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
			return pixels;
		} finally { buffer.destroy(); target.destroy(); }
	}
	function createEffect(width: number, height: number, format: IntermediateTextureFormat = 'rgba8unorm', enable32bitDataTextures = false) {
		const resolution = { width, height };
		const wgpu = { device, intermediateTextureFormat: format, enable32bitDataTextures, defaultVertexShaderModule: vertex };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		owned.push(output);
		const effect = implementation.init({ wgpu, resolution, params: defaults, reportStatus: () => {}, fallbackTexture: output });
		effects.push(effect);
		return {
			async render(overrides: Partial<Parameters> = {}, time = 0) {
				const commandEncoder = device.createCommandEncoder();
				effect.render({ params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 16,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
					createComputePassEncoder: encoder => encoder.beginComputePass(),
					createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				device.queue.submit([commandEncoder.finish()]);
				await validate();
				return read(output);
			},
		};
	}
	function image(width: number, height: number, paint: (x: number, y: number) => readonly number[], wrapMode: 'transparent' | 'repeat' = 'transparent') {
		const pixels = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(paint(x, y), (y * width + x) * 4);
		const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		owned.push(texture);
		device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 4 }, [width, height]);
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode, filterMode: 'nearest' });
	}
	const transparent = [0, 0, 0, 0];
	const red = [255, 0, 0, 255];
	const blue = [0, 0, 255, 255];
	const black = [0, 0, 0, 255];
	const at = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
	const equalPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray, message: string) => assert(a.every((value, index) => value === b[index]), message);
	try {
		const effect = createEffect(96, 64);
		// 【透明入力と定数入力】空間内に物体がない場合の無効seedや、uniform/texture切替を確認する。
		const empty = await effect.render();
		assert(empty.every((value, index) => value === (index % 4 === 3 ? 255 : 0)), 'transparent input must output opaque black');
		equalPixels(empty, await effect.render({ input: { kind: 'uniform', value: [1, 0.5, 0.2, 0] } }), 'hidden RGB must not emit');
		const solid = await effect.render({ input: constantShaderInput('color', [0.8, 0.4, 0.2, 0.5]) });
		assert(at(solid, 96, 48, 32).every((value, index) => Math.abs(value - [102, 51, 26, 255][index]) <= 1), 'uniform premultiplied source');
		checks.push('transparent input', 'uniform input and premultiplied alpha');

		// 【異なる入力解像度と上下方向】入力のfitは最終出力を基準とし、内部描画で上下反転しない。
		const smallInput = image(6, 4, (x, y) => x === 2 && y === 0 ? red : transparent);
		const fitted = await effect.render({ input: smallInput, emissionStrength: 0 });
		assert(at(fitted, 96, 36, 4)[0] === 255 && at(fitted, 96, 36, 60)[0] === 0, 'input fit or Y orientation');
		checks.push('input resolution and orientation');

		// 【1画素の壁と縮小照明】幾何情報の縮小や補間によって壁の反対側へ光が漏れないことを確認する。
		const scene = image(96, 64, (x, y) => x === 48 ? black : x >= 12 && x < 20 && y >= 20 && y < 44 ? red : transparent);
		for (const resolutionScale of [1, 0.5, 0.25]) {
			const output = await effect.render({ input: scene, resolutionScale, absorption: 0 });
			assert(at(output, 96, 32, 32)[0] > 15, `light missing at scale ${resolutionScale}`);
			for (const x of [48, 49, 50, 51, 65, 90]) assert(at(output, 96, x, 32)[0] === 0, `wall leak at ${x}, scale ${resolutionScale}`);
			assert(at(output, 96, 15, 30)[0] === 255, 'source outline changed');
		}
		checks.push('direct emission', 'one-pixel occluder', 'occlusion-aware upsampling', 'resolution changes');

		// 【複数色の光・減衰・描画順序】最寄り光源だけでなく両方の色を集め、履歴に依存せず再描画できることを確認する。
		const twoLights = image(96, 64, (x, y) => y >= 16 && y < 48 ? x >= 8 && x < 16 ? red : x >= 80 && x < 88 ? blue : transparent : transparent);
		const settings = { input: twoLights, absorption: 0, resolutionScale: 1, rayCount: 128 };
		const original = await effect.render(settings);
		const center = at(original, 96, 48, 32);
		assert(center[0] > 15 && center[2] > 15 && center[1] === 0, `mixed illumination missing: ${center}`);
		const absorbed = await effect.render({ ...settings, absorption: 8 });
		assert(at(absorbed, 96, 48, 32)[0] < center[0] / 4, 'absorption does not attenuate');
		const changedSeed = await effect.render({ ...settings, seed: 123 }, 12);
		assert(original.some((value, index) => value !== changedSeed[index]), 'seed does not change angular sampling');
		equalPixels(original, await effect.render(settings, 400), 'time or history changes lighting');
		const disabled = await effect.render({ ...settings, emissionStrength: 0 });
		assert(at(disabled, 96, 48, 32)[0] === 0 && at(disabled, 96, 10, 30)[0] === 255, 'zero strength leaves stale lighting or removes source');
		equalPixels(empty, await effect.render(), 'input removal leaves stale seeds');
		checks.push('multiple colored emitters', 'absorption', 'seed', 'time and history independence', 'zero strength and input removal');

		// 【半透明光源とα閾値】乗算済みRGBの二重乗算を避け、閾値で幾何情報だけを除外できることを確認する。
		const fullEmitter = image(96, 64, (x, y) => x === 24 && y >= 20 && y < 44 ? red : transparent);
		const halfEmitter = image(96, 64, (x, y) => x === 24 && y >= 20 && y < 44 ? [128, 0, 0, 128] : transparent);
		const fullLight = await effect.render({ input: fullEmitter, resolutionScale: 1, absorption: 0 });
		const halfLight = await effect.render({ input: halfEmitter, resolutionScale: 1, absorption: 0 });
		const fullValue = at(fullLight, 96, 32, 32)[0];
		assert(fullValue > 20, 'one-pixel emitter missing');
		assert(Math.abs(at(halfLight, 96, 32, 32)[0] - fullValue * 128 / 255) <= 1, 'alpha multiplied twice');
		const rejected = await effect.render({ input: halfEmitter, alphaThreshold: 0.75 });
		assert(at(rejected, 96, 32, 32)[0] === 0 && at(rejected, 96, 24, 32)[0] === 128, 'alpha threshold or source composite');
		checks.push('one-pixel emitter', 'partial-alpha emission', 'alpha threshold');

		// 【画面境界とテクスチャ形式】入力のrepeatで反対側から光を拾わず、精度設定を変えても同じ契約で描画する。
		const edgeEmitter = image(96, 64, x => x >= 90 && x < 94 ? red : transparent, 'repeat');
		const bounded = await effect.render({ input: edgeEmitter, absorption: 10, resolutionScale: 1 });
		assert(at(bounded, 96, 2, 32)[0] === 0, 'ray wrapped around the scene boundary');
		checks.push('bounded lighting space');
		for (const format of ['bgra8unorm', 'rgba16float'] as const) {
			const formatted = await createEffect(96, 64, format).render(settings);
			assert(at(formatted, 96, 48, 32).every((value, index) => Math.abs(value - center[index]) <= 1), `output format ${format}`);
		}
		if (supports32bit) {
			const precise = await createEffect(96, 64, 'rgba8unorm', true).render(settings);
			assert(at(precise, 96, 48, 32).every((value, index) => Math.abs(value - center[index]) <= 1), '32bit internal data');
			checks.push('32bit internal textures');
		}
		const small = await createEffect(1, 1).render({ input: constantShaderInput('color', [1, 0, 0, 1]) });
		assert(small[0] === 255 && small[3] === 255, 'one-pixel output');
		checks.push('output formats', 'one-pixel output');

		// 【大きな座標】16bit floatの連続整数範囲を超える位置の細線でも、光源・壁の位置を混同しない。
		const wideScene = image(4096, 8, x => x === 3001 ? red : x === 3003 ? black : transparent);
		const wide = await createEffect(4096, 8).render({ input: wideScene, absorption: 0, resolutionScale: 1, rayCount: 16 });
		assert(at(wide, 4096, 3002, 4)[0] > 0 && at(wide, 4096, 3004, 4)[0] === 0, 'large seed coordinates');
		checks.push('large seed coordinates');

		const previewWidth = 512;
		const previewHeight = 288;
		const circles = [
			[100, 90, 14, [255, 180, 50, 255]], [210, 190, 18, [50, 200, 220, 255]],
			[365, 80, 12, [255, 60, 85, 255]], [410, 210, 20, [240, 235, 170, 255]],
			[95, 210, 16, black], [350, 170, 12, black],
		] as const;
		const previewInput = image(previewWidth, previewHeight, (x, y) => {
			if (x >= 260 && x < 263 && y >= 30 && y < 220) return black;
			for (const [cx, cy, radius, color] of circles) if ((x - cx) ** 2 + (y - cy) ** 2 < radius ** 2) return color;
			return transparent;
		});
		const previewPixels = await createEffect(previewWidth, previewHeight).render({ input: previewInput, rayCount: 128, emissionStrength: 3, absorption: 0.8 });
		const canvas = new OffscreenCanvas(previewWidth, previewHeight);
		canvas.getContext('2d')!.putImageData(new ImageData(previewPixels, previewWidth, previewHeight), 0, 0);
		const png = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
		const preview = btoa(Array.from(png, byte => String.fromCharCode(byte)).join(''));
		await validate();
		return { checks, preview };
	} finally {
		for (const effect of effects) effect.dispose();
		for (const resource of owned) resource.destroy();
		device.destroy();
	}
}
