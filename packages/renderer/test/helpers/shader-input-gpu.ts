import { checkMigratedEffects } from './migrated-shader-input-gpu.ts';
import { checkGradientInputs } from './gradient-shader-input-gpu.ts';
import effect from '../../../shared/src/effects/colorMix/_impl_.ts';
import rawImage from '../../../shared/src/effects/rawImage/_impl_.ts';
import blockShuffle from '../../../shared/src/effects/blockShuffle/_impl_.ts';
import { constantShaderInput, textureShaderInput, generateShaderInputs, createShaderInputBindings } from '../../../shared/src/shader-input.ts';
import vertexCode from '../../src/vertex.wgsl?raw';

// 実際のGPU出力を読む。モックでは検出できないWGSL・layout・補間の不整合を確認する。
export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('float32-filterable') ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const textures: GPUTexture[] = [];
	const vertex = device.createShaderModule({ code: vertexCode });
	const instance = effect.init({ wgpu: { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' } } as any);
	const completed: string[] = [];
	function check(name: string, actual: readonly number[], expected: readonly number[], tolerance = 2) {
		if (actual.some((v, i) => Math.abs(v - expected[i]) > tolerance)) throw new Error(`${name}: ${actual} != ${expected}`);
		completed.push(name);
	}
	function texture(width: number, height: number, pixels?: number[], format: GPUTextureFormat = 'rgba8unorm') {
		const t = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
		textures.push(t);
		if (pixels) {
			const data = format === 'r32float' ? new Float32Array(pixels) : format === 'r16float' ? new Uint16Array(pixels) : new Uint8Array(pixels);
			device.queue.writeTexture({ texture: t }, data, { bytesPerRow: data.byteLength / height }, [width, height]);
		}
		return t;
	}
	async function read(output: GPUTexture, encoder: GPUCommandEncoder) {
		const buffer = device.createBuffer({ size: output.height * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: 256 }, [output.width, output.height]);
		device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		const bytes = new Uint8Array(buffer.getMappedRange());
		const pixels = Array.from({ length: output.height }, (_, y) => Array.from(bytes.slice(y * 256, y * 256 + output.width * 4)));
		buffer.unmap();
		buffer.destroy();
		return pixels;
	}
	async function mix(params: any, width = 1, height = 1) {
		const output = texture(width, height);
		const encoder = device.createCommandEncoder();
		instance.render({ params, commandEncoder: encoder, outputDataMap: { output: { texture: output, textureView: output.createView() } }, createPassEncoderFor: (_, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }) } as any);
		return read(output, encoder);
	}
	try {
		// Raw Imageは素材の各画素を保持し、半透明色だけ一度premultiplyする。
		const rawSource = texture(2, 2, [255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 64, 255, 255, 255, 0]);
		const rawOutput = texture(2, 2);
		const raw = rawImage.init({ wgpu: { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' } } as any);
		const rawEncoder = device.createCommandEncoder();
		raw.render({ params: { image: rawSource }, commandEncoder: rawEncoder, outputDataMap: { output: { texture: rawOutput, textureView: rawOutput.createView() } }, createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor) } as any);
		const rawPixels = await read(rawOutput, rawEncoder);
		check('raw image top row and half alpha', rawPixels[0], [128, 0, 0, 128, 0, 255, 0, 255]);
		check('raw image bottom row and zero alpha', rawPixels[1], [0, 0, 64, 64, 0, 0, 0, 0]);
		const emptyEncoder = device.createCommandEncoder();
		raw.render({ params: { image: null }, commandEncoder: emptyEncoder, outputDataMap: { output: { texture: rawOutput, textureView: rawOutput.createView() } }, createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor) } as any);
		check('raw image without asset is transparent', (await read(rawOutput, emptyEncoder))[0], Array(8).fill(0));
		raw.dispose();
		const a = constantShaderInput('color', [1, 0, 0, 0.5]);
		const b = constantShaderInput('color', [0, 0, 1, 1]);
		const amount = constantShaderInput('scalar', 0.25);
		const at = textureShaderInput(texture(1, 1, [128, 0, 0, 128]));
		const bt = textureShaderInput(texture(1, 1, [0, 0, 255, 255]));
		const mt = textureShaderInput(texture(1, 1, [64, 0, 0, 255]));
		// 3入力の全8構成を同じinstanceで切り替え、uniformとtextureの意味を揃える。
		for (let mask = 0; mask < 8; mask++) {
			const pixels = await mix({ inputA: mask & 1 ? at : a, inputB: mask & 2 ? bt : b, amount: mask & 4 ? mt : amount });
			check(`mix variant ${mask}`, pixels[0], [96, 0, 64, 159]);
		}
		check('clamps amount below zero', (await mix({ inputA: a, inputB: b, amount: constantShaderInput('scalar', -1) }))[0], [128, 0, 0, 128]);
		check('clamps amount above one', (await mix({ inputA: a, inputB: b, amount: constantShaderInput('scalar', 2) }))[0], [0, 0, 255, 255]);
		// halfの0と1の中間を読むことで、16bit保存形式と線形フィルタリングを確認する。
		check('filters r16float data', (await mix({ inputA: a, inputB: b, amount: textureShaderInput(texture(2, 1, [0, 0x3c00], 'r16float')) }))[0], [64, 0, 128, 191]);
		if (device.features.has('float32-filterable')) {
			check('reads r32float data', (await mix({ inputA: a, inputB: b, amount: textureShaderInput(texture(1, 1, [0.25], 'r32float')) }))[0], [96, 0, 64, 159]);
		}
		const wide = texture(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
		const zero = constantShaderInput('scalar', 0);
		let pixels = await mix({ inputA: textureShaderInput(wide, { fitMode: 'contain' }), inputB: b, amount: zero }, 4, 4);
		check('contain margin uses mirrored repeat by default', pixels[0].slice(0, 4), [255, 0, 0, 255]);
		check('contain preserves visible image', pixels[1].slice(0, 4), [255, 0, 0, 255]);
		pixels = await mix({ inputA: textureShaderInput(wide), inputB: b, amount: zero }, 4, 4);
		check('cover samples centered horizontal crop', pixels[0].slice(0, 4), [223, 0, 32, 255]);
		pixels = await mix({ inputA: textureShaderInput(wide, { fitMode: 'stretch' }), inputB: b, amount: zero }, 4, 4);
		check('stretch reaches input edge', pixels[0].slice(0, 4), [255, 0, 0, 255]);
		// transparentの余白判定は、境界画素の補間領域より十分外側で確認する。
		const wideForMargins = texture(8, 4, Array.from({ length: 32 }, (_, i) => i % 8 < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat());
		const tall = texture(4, 8, Array.from({ length: 32 }, (_, i) => i < 16 ? [0, 255, 0, 255] : [255, 255, 0, 255]).flat());
		pixels = await mix({ inputA: textureShaderInput(wideForMargins, { fitMode: 'contain', wrapMode: 'transparent' }), inputB: textureShaderInput(tall, { fitMode: 'contain', wrapMode: 'transparent' }), amount }, 4, 4);
		check('different input aspects leave independent margins', pixels[0].slice(0, 4), [0, 0, 0, 0]);
		check('positive Y reads the top row', pixels[0].slice(4, 8), [0, 64, 0, 64]);

		// containの余白でもwrapを尊重する。上半分が赤、下半分が青の素材で
		// clamp/mirrorとrepeatの参照先、およびtransparentの0を区別する。
		const striped = texture(4, 2, Array.from({ length: 8 }, (_, i) => i < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat());
		// Block Shuffleの選択／非選択タイルのどちらでも、接続のfit/wrapを適用する。
		// 変形を無効にしてColor Mixの入力参照と比較し、上下反転も検出する。
		const blocks = blockShuffle.init({ wgpu: { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' }, resolution: { width: 4, height: 4 } } as any);
		try {
			for (const fitMode of ['stretch', 'cover', 'contain'] as const) {
				for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored', 'transparent'] as const) {
					const input = textureShaderInput(striped, { fitMode, wrapMode });
					const expected = (await mix({ inputA: input, inputB: b, amount: zero }, 4, 4)).flat();
					for (const selection of [0, 1]) {
						const output = texture(4, 4);
						const encoder = device.createCommandEncoder();
						blocks.render({
							params: { input, size: constantShaderInput('vector', [0.5, 0.75]), amount: selection, fitMode: 'contain', seed: 123, randomSwap: false, randomRotation: false, randomFlipX: false, randomFlipY: false },
							commandEncoder: encoder, outputDataMap: { output: { texture: output, textureView: output.createView() } },
							createPassEncoderFor: (_: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
						} as any);
						check(`blockShuffle ${fitMode} ${wrapMode} selection ${selection}`, (await read(output, encoder)).flat(), expected);
					}
				}
			}
		} finally {
			blocks.dispose();
		}
		for (const [wrapMode, expected] of [['clamp', [255, 0, 0, 255]], ['repeat', [0, 0, 255, 255]], ['repeatMirrored', [255, 0, 0, 255]], ['transparent', [0, 0, 0, 0]]] as const) {
			const result = await mix({ inputA: textureShaderInput(striped, { fitMode: 'contain', wrapMode }), inputB: b, amount: zero }, 4, 4);
			check('contain margin with ' + wrapMode, result[0].slice(0, 4), expected);
		}

		// fitとは独立に、共通入力APIへ範囲外座標を直接渡してwrapを確認する。
		for (const [wrapMode, expected] of [['clamp', [0, 0, 255, 255]], ['repeat', [255, 0, 0, 255]], ['repeatMirrored', [0, 0, 255, 255]], ['transparent', [0, 0, 0, 0]]] as const) {
			const inputs = { source: textureShaderInput(wide, { fitMode: 'stretch', wrapMode }) };
			const generated = generateShaderInputs({ source: 'color' }, inputs);
			const bindings = createShaderInputBindings(device, generated);
			const output = texture(1, 1);
			const pipeline = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }), vertex: { module: vertex }, fragment: { module: device.createShaderModule({ code: generated.code + '\n@fragment fn fs() -> @location(0) vec4f { return read_source(vec2f(1.5, 0.0)); }' }), targets: [{ format: 'rgba8unorm' }] } });
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindings.update(inputs, output));
			pass.draw(6);
			pass.end();
			check(`wrap ${wrapMode}`, (await read(output, encoder))[0], expected);
			bindings.dispose();
		}
		completed.push(...await checkMigratedEffects(device, vertex, async output => (await mix({ inputA: textureShaderInput(output), inputB: b, amount: zero }, output.width, output.height)).flat()));
		completed.push(...await checkGradientInputs(device, vertex));
		const error = await device.popErrorScope();
		if (error) throw new Error(error.message);
		return completed;
	} finally {
		instance.dispose();
		for (const t of textures) t.destroy();
		device.destroy();
	}
}
