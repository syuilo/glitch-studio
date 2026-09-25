import { checkMigratedEffects } from './migrated-shader-input-gpu.ts';
import { checkGradientInputs } from './gradient-shader-input-gpu.ts';
import { checkTimelineCompositor } from './timeline-compositor-gpu.ts';
import effect from '../../../shared/src/effect/fx/colorMix/_impl_.ts';
import imageEffect from '../../../shared/src/effect/fx/image/_impl_.ts';
import blockShuffle from '../../../shared/src/effect/fx/blockShuffle/_impl_.ts';
import { constantShaderInput, textureShaderInput, generateShaderInputs, createShaderInputBindings } from '../../../shared/src/shader-input.ts';
import vertexCode from '../../src/vertex.wgsl?raw';
import { createShaderInputPipeline } from '../../../shared/src/shader-input-pipeline.ts';

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
		const bytesPerRow = Math.ceil(output.width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: output.height * bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, [output.width, output.height]);
		device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		const bytes = new Uint8Array(buffer.getMappedRange());
		const pixels = Array.from({ length: output.height }, (_, y) => Array.from(bytes.slice(y * bytesPerRow, y * bytesPerRow + output.width * 4)));
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
		// 画素ごとに異なる配列要素を選び、定数・補間・境界処理を実際のWGSLで確認する。
		const arrayPipelines = createShaderInputPipeline({
			device, vertex, schema: { images: { array: 'color' } }, targets: [{ format: 'rgba8unorm' }],
			code: '@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f { return read_images(u32(pixel.x), vec2f(0.0, 0.75)); }',
		});
		const arrayOutput = texture(5, 1);
		const arraySource = texture(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
		const marginSource = texture(8, 2, Array(16).fill([255, 255, 255, 255]).flat());
		const arrayInputs = [
			constantShaderInput('color', [1, 0, 0, 0.5]),
			textureShaderInput(arraySource, { filterMode: 'linear', fitMode: 'stretch', wrapMode: 'clamp' }),
			textureShaderInput(arraySource, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }),
			textureShaderInput(marginSource, { filterMode: 'linear', fitMode: 'contain', wrapMode: 'transparent' }),
		];
		const drawArray = async (images: typeof arrayInputs) => {
			// fitの基準を正方形とし、横長の集計用出力とは独立にcontainを検証する。
			const variant = arrayPipelines.update({ images }, { width: 8, height: 8 });
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: arrayOutput.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(variant.pipeline);
			pass.setBindGroup(0, variant.bindGroup);
			pass.draw(6);
			pass.end();
			return (await read(arrayOutput, encoder))[0];
		};
		try {
			const expected = [128, 0, 0, 128, 128, 0, 128, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0];
			check('array selects mixed inputs per pixel and returns zero out of range', await drawArray(arrayInputs), expected);
			// 空配列のstruct・selectorも有効なシェーダーになり、古いbindingを参照しない。
			check('empty array returns transparent', await drawArray([]), Array(20).fill(0));
			check('shorter array drops old entries', await drawArray([constantShaderInput('color', [0, 1, 0, 1])]), [0, 255, 0, 255, ...Array(16).fill(0)]);
			check('array restores cached mixed variant', await drawArray(arrayInputs), expected);
			arrayInputs[1] = textureShaderInput(arraySource, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
			check('array filter change updates cached variant', (await drawArray(arrayInputs)).slice(4, 8), [0, 0, 255, 255]);
		} finally { arrayPipelines.dispose(); }
		// スカラー配列の微分と、空のvector/any配列も型の一致した選択関数になる。
		const gradientArrayPipelines = createShaderInputPipeline({
			device, vertex, schema: { fields: { array: 'scalar' }, vectors: { array: 'vector' }, data: { array: 'any' } },
			targets: [{ format: 'rgba8unorm' }], sampling: 'level0', scalarGradients: true,
			code: '@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f { return vec4f(readGradient_fields(u32(pixel.x), vec2f(0.0), true), 1.0) + vec4f(read_vectors(0u, vec2f(0.0)), 0.0, 0.0) + read_data(0u, vec2f(0.0)); }',
		});
		try {
			const ramp = texture(2, 1, [0, 0, 0, 255, 255, 0, 0, 255]);
			const variant = gradientArrayPipelines.update({ fields: [constantShaderInput('scalar', 0.25), textureShaderInput(ramp, { wrapMode: 'repeatMirrored', filterMode: 'linear', fitMode: 'stretch' })], vectors: [], data: [] }, arrayOutput);
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: arrayOutput.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(variant.pipeline);
			pass.setBindGroup(0, variant.bindGroup);
			pass.draw(6);
			pass.end();
			check('scalar array derivatives and empty typed selectors', (await read(arrayOutput, encoder))[0], [64, 0, 0, 255, 128, 255, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
		} finally { gradientArrayPipelines.dispose(); }
		// Image Originalは素材の各画素を保持し、半透明色だけ一度premultiplyする。
		const rawSource = texture(2, 2, [255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 64, 255, 255, 255, 0]);
		const rawOutput = texture(2, 2);
		const raw = imageEffect.init({ wgpu: { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' } } as any);
		const rawEncoder = device.createCommandEncoder();
		raw.render({ params: { image: rawSource, sizeMode: 3 }, commandEncoder: rawEncoder, outputDataMap: { output: { texture: rawOutput, textureView: rawOutput.createView() } }, createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }), createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor) } as any);
		const rawPixels = await read(rawOutput, rawEncoder);
		check('original image top row and half alpha', rawPixels[0], [128, 0, 0, 128, 0, 255, 0, 255]);
		check('original image bottom row and zero alpha', rawPixels[1], [0, 0, 64, 64, 0, 0, 0, 0]);
		const emptyEncoder = device.createCommandEncoder();
		raw.render({ params: { image: null, sizeMode: 3 }, commandEncoder: emptyEncoder, outputDataMap: { output: { texture: rawOutput, textureView: rawOutput.createView() } }, createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }), createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor) } as any);
		check('original image without asset is transparent', (await read(rawOutput, emptyEncoder))[0], Array(8).fill(0));
		raw.dispose();
		const a = constantShaderInput('color', [1, 0, 0, 0.5]);
		const b = constantShaderInput('color', [0, 0, 1, 1]);
		const amount = constantShaderInput('scalar', 0.25);
		const at = textureShaderInput(texture(1, 1, [128, 0, 0, 128]), { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
		const bt = textureShaderInput(texture(1, 1, [0, 0, 255, 255]), { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
		const mt = textureShaderInput(texture(1, 1, [64, 0, 0, 255]), { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
		// 3入力の全8構成を同じinstanceで切り替え、uniformとtextureの意味を揃える。
		for (let mask = 0; mask < 8; mask++) {
			const pixels = await mix({ inputA: mask & 1 ? at : a, inputB: mask & 2 ? bt : b, amount: mask & 4 ? mt : amount });
			check(`mix variant ${mask}`, pixels[0], [96, 0, 64, 159]);
		}
		check('clamps amount below zero', (await mix({ inputA: a, inputB: b, amount: constantShaderInput('scalar', -1) }))[0], [128, 0, 0, 128]);
		check('clamps amount above one', (await mix({ inputA: a, inputB: b, amount: constantShaderInput('scalar', 2) }))[0], [0, 0, 255, 255]);
		// halfの0と1の中間を読むことで、16bit保存形式と線形フィルタリングを確認する。
		check('filters r16float data', (await mix({ inputA: a, inputB: b, amount: textureShaderInput(texture(2, 1, [0, 0x3c00], 'r16float'), { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }) }))[0], [64, 0, 128, 191]);
		if (device.features.has('float32-filterable')) {
			check('reads r32float data', (await mix({ inputA: a, inputB: b, amount: textureShaderInput(texture(1, 1, [0.25], 'r32float'), { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }) }))[0], [96, 0, 64, 159]);
		}
		const wide = texture(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
		const zero = constantShaderInput('scalar', 0);
		let pixels = await mix({ inputA: textureShaderInput(wide, { wrapMode: 'repeatMirrored', filterMode: 'linear', fitMode: 'contain' }), inputB: b, amount: zero }, 4, 4);
		check('contain margin uses mirrored repeat by default', pixels[0].slice(0, 4), [255, 0, 0, 255]);
		check('contain preserves visible image', pixels[1].slice(0, 4), [255, 0, 0, 255]);
		pixels = await mix({ inputA: textureShaderInput(wide, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }), inputB: b, amount: zero }, 4, 4);
		check('cover samples centered horizontal crop', pixels[0].slice(0, 4), [223, 0, 32, 255]);
		pixels = await mix({ inputA: textureShaderInput(wide, { wrapMode: 'repeatMirrored', filterMode: 'linear', fitMode: 'stretch' }), inputB: b, amount: zero }, 4, 4);
		check('stretch reaches input edge', pixels[0].slice(0, 4), [255, 0, 0, 255]);
		// transparentの余白判定は、境界画素の補間領域より十分外側で確認する。
		const wideForMargins = texture(8, 4, Array.from({ length: 32 }, (_, i) => i % 8 < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat());
		const tall = texture(4, 8, Array.from({ length: 32 }, (_, i) => i < 16 ? [0, 255, 0, 255] : [255, 255, 0, 255]).flat());
		pixels = await mix({ inputA: textureShaderInput(wideForMargins, { filterMode: 'linear', fitMode: 'contain', wrapMode: 'transparent' }), inputB: textureShaderInput(tall, { filterMode: 'linear', fitMode: 'contain', wrapMode: 'transparent' }), amount }, 4, 4);
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
					const input = textureShaderInput(striped, { filterMode: 'linear', fitMode, wrapMode });
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
			const result = await mix({ inputA: textureShaderInput(striped, { filterMode: 'linear', fitMode: 'contain', wrapMode }), inputB: b, amount: zero }, 4, 4);
			check('contain margin with ' + wrapMode, result[0].slice(0, 4), expected);
		}

		// fitとは独立に、共通入力APIへ範囲外座標を直接渡してwrapを確認する。
		for (const [wrapMode, expected] of [['clamp', [0, 0, 255, 255]], ['repeat', [255, 0, 0, 255]], ['repeatMirrored', [0, 0, 255, 255]], ['transparent', [0, 0, 0, 0]]] as const) {
			const inputs = { source: textureShaderInput(wide, { filterMode: 'linear', fitMode: 'stretch', wrapMode }) };
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
		// 同じpipelineのままfilterを変更し、画素間補間と透明境界の違いを確認する。
		for (const [x, linear, nearest] of [
			[-0.25, [191, 0, 64, 255], [255, 0, 0, 255]],
			[-1, [128, 0, 0, 128], [255, 0, 0, 255]],
			[1.1, [0, 0, 102, 102], [0, 0, 0, 0]],
		] as const) {
			const source = textureShaderInput(wide, { filterMode: 'linear', fitMode: 'stretch', wrapMode: 'transparent' });
			const generated = generateShaderInputs({ source: 'color' }, { source });
			const bindings = createShaderInputBindings(device, generated);
			const output = texture(1, 1);
			const pipeline = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }), vertex: { module: vertex }, fragment: { module: device.createShaderModule({ code: generated.code + `\n@fragment fn fs() -> @location(0) vec4f { return read_source(vec2f(${x}, 0.0)); }` }), targets: [{ format: 'rgba8unorm' }] } });
			try {
				for (const filterMode of ['linear', 'nearest', 'linear'] as const) {
					const input = textureShaderInput(wide, { fitMode: 'stretch', wrapMode: 'transparent', filterMode });
					const encoder = device.createCommandEncoder();
					const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, bindings.update({ source: input }, output));
					pass.draw(6);
					pass.end();
					check(`filter ${filterMode} at ${x}`, (await read(output, encoder))[0], filterMode === 'linear' ? linear : nearest);
				}
			} finally {
				bindings.dispose();
			}
		}
		completed.push(...await checkMigratedEffects(device, vertex, async output => (await mix({ inputA: textureShaderInput(output, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }), inputB: b, amount: zero }, output.width, output.height)).flat()));
		completed.push(...await checkGradientInputs(device, vertex));
		completed.push(...await checkTimelineCompositor(device, vertex, async output => (await mix({ inputA: textureShaderInput(output, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }), inputB: b, amount: zero }, output.width, output.height)).flat()));
		const error = await device.popErrorScope();
		if (error) throw new Error(error.message);
		return completed;
	} finally {
		instance.dispose();
		for (const t of textures) t.destroy();
		device.destroy();
	}
}
