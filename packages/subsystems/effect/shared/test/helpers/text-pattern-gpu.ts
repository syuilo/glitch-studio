import definition from '../../src/fx/textPattern/_def_.ts';
import implementation from '../../src/fx/textPattern/_impl_.ts';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const vector = (value: [number, number]) => constantShaderInput('vector', value);
	const color = (value: [number, number, number, number]) => constantShaderInput('color', value);
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const owned: { destroy(): void }[] = [];
	const effects: { dispose(): void }[] = [];
	const readModule = device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	let points = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	return vec4f(points[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` });
	const readPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: readModule }, fragment: { module: readModule, targets: [{ format: 'rgba8unorm' }] } });

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
			pass.draw(3);
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

	function createEffect(width: number, height: number, format: IntermediateTextureFormat = 'rgba8unorm') {
		const resolution = { width, height };
		const wgpu = { device, intermediateTextureFormat: format, enable32bitDataTextures: false, defaultVertexShaderModule: readModule };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		owned.push(output);
		const base: Parameters = { ...defaults, text: 'F', size: 0.22, repetitions: [1, 1] };
		let onStatus: ((status: { type: string; message?: string }) => void) | null = null;
		let effect = implementation.init({ wgpu, resolution, params: base, resources: { font: null }, reportStatus: status => onStatus?.(status), fallbackTexture: output });
		effects.push(effect);
		return {
			base, output,
			async render(overrides: Partial<Parameters> = {}) {
				const params = { ...base, ...overrides };
				const commandEncoder = device.createCommandEncoder();
				effect.render({ params, commandEncoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
					createComputePassEncoder: encoder => encoder.beginComputePass(),
					createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				device.queue.submit([commandEncoder.finish()]);
				return read(output);
			},
			async loadFont(fileData: Blob) {
				await new Promise<void>((resolve, reject) => {
					onStatus = status => { if (status.type === 'ready') resolve(); else if (status.type === 'error') reject(new Error(status.message)); };
					effect.dispose();
					effect = implementation.init({ wgpu, resolution, params: base, resources: { font: fileData }, reportStatus: status => onStatus?.(status), fallbackTexture: output });
					effects.push(effect);
				});
				onStatus = null;
				return font;
			},
		};
	}

	function metrics(pixels: Uint8ClampedArray, width: number) {
		let area = 0;
		let sumX = 0;
		let sumY = 0;
		let minX = width;
		let maxX = -1;
		let minY = pixels.length / width / 4;
		let maxY = -1;
		for (let i = 0; i < pixels.length; i += 4) {
			const alpha = pixels[i + 3] / 255;
			if (alpha === 0) continue;
			const x = i / 4 % width + 0.5;
			const y = Math.floor(i / 4 / width) + 0.5;
			area += alpha;
			sumX += x * alpha;
			sumY += y * alpha;
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		}
		return { area, x: sumX / area, y: sumY / area, minX, maxX, minY, maxY };
	}
	function close(actual: number, expected: number, tolerance: number, message: string) { assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`); }
	function equalPixels(actual: Uint8ClampedArray, expected: Uint8ClampedArray, tolerance = 1) { assert(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), 'pixel arrays differ'); }
	function texture(values: number[]) {
		const width = values.length / 4;
		const image = device.createTexture({ size: [width, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		owned.push(image);
		device.queue.writeTexture({ texture: image }, new Uint8Array(values), { bytesPerRow: width * 4 }, [width, 1]);
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
	}

	try {
		const effect = createEffect(256, 128);
		const original = await effect.render();
		const originalMetrics = metrics(original, 256);
		assert(originalMetrics.area > 30, 'base glyph missing');
		checks.push('glyph atlas');
		const translated = metrics(await effect.render({ translation: vector([0.5, -0.25]) }), 256);
		close(translated.x - originalMetrics.x, 64, 0.2, 'translation x');
		close(translated.y - originalMetrics.y, 16, 0.2, 'translation y');
		checks.push('translation');
		const faded = await effect.render({ opacity: scalar(0.5), color: color([0.8, 0.4, 0.2, 0.5]) });
		const colored = await effect.render({ color: color([0.8, 0.4, 0.2, 0.5]) });
		assert(faded.every((value, index) => Math.abs(value - colored[index] * 0.5) <= 1), 'premultiplied opacity');
		checks.push('opacity and premultiplied color');
		close(metrics(await effect.render({ opacity: scalar(2) }), 256).area, originalMetrics.area, 0.1, 'clamp opacity');
		assert(metrics(await effect.render({ opacity: scalar(-1) }), 256).area === 0, 'negative opacity');
		checks.push('opacity range');
		const enlarged = metrics(await effect.render({ scale: scalar(2) }), 256);
		close(enlarged.area / originalMetrics.area, 4, 0.1, 'scale area');
		const rotated = metrics(await effect.render({ rotation: scalar(0.25) }), 256);
		close(rotated.maxX - rotated.minX, originalMetrics.maxY - originalMetrics.minY, 1, 'rotation aspect x');
		close(rotated.maxY - rotated.minY, originalMetrics.maxX - originalMetrics.minX, 1, 'rotation aspect y');
		close(rotated.x, 128 - (originalMetrics.y - 64), 0.2, 'rotation center x');
		close(rotated.y, 64 + (originalMetrics.x - 128), 0.2, 'rotation center y');
		checks.push('scale', 'rotation and aspect ratio');
		equalPixels(await effect.render({ scale: scalar(-1) }), await effect.render({ rotation: scalar(0.5) }));
		assert(metrics(await effect.render({ scale: scalar(0) }), 256).area === 0, 'zero scale');
		checks.push('negative and zero scale');
		// Trackingの一様な加算は、フォントの空白幅に一致させれば空白文字の挿入と同じになる。
		// 文字の後ろだけに追加し、行末に余分な間隔を付けず、全ての整列で行全体を揃える。
		const measuringCanvas = new OffscreenCanvas(1, 1);
		const measuringContext = measuringCanvas.getContext('2d')!;
		const fontSize = effect.base.size * effect.output.height;
		measuringContext.font = `${fontSize}px sans-serif`;
		const spaceRatio = measuringContext.measureText(' ').width / fontSize;
		for (const align of ['left', 'center', 'right'] as const) {
			equalPixels(await effect.render({ text: 'FFF', align, tracking: scalar(spaceRatio) }), await effect.render({ text: 'F F F', align }));
			equalPixels(await effect.render({ text: 'F F F', align, tracking: scalar(-spaceRatio / 2) }), await effect.render({ text: 'FFF', align }));
		}
		equalPixels(await effect.render({ tracking: scalar(1) }), original);
		checks.push('tracking and alignment', 'negative tracking and whitespace', 'single-character tracking');
		// 均等割付は字形の拡大ではなく、画面幅を満たす一定の字間追加と同じ画素になる。
		const distributedTracking = (effect.output.width - measuringContext.measureText('F').width * 3) / (2 * fontSize);
		const distributed = await effect.render({ text: 'FFF', align: 'distribute' });
		equalPixels(distributed, await effect.render({ text: 'FFF', tracking: scalar(distributedTracking) }));
		// 両端を固定する場合、一様なTrackingには内部の疎密を変える成分がない。
		// 正・負の値でも行幅や字形のサイズが変わらないことを画素で確認する。
		for (const tracking of [-1, 0.25, 1]) equalPixels(await effect.render({ text: 'FFF', align: 'distribute', tracking: scalar(tracking) }), distributed);
		equalPixels(await effect.render({ align: 'distribute' }), original);
		const distributedRows = await effect.render({ text: 'FFF\nF', repetitions: [1, 2], align: 'distribute', size: 0.15 });
		assert(metrics(distributedRows, 256).area > 30, 'distributed repeated multiline text');
		checks.push('distributed alignment', 'uniform tracking with fixed endpoints', 'distributed single and multiline text');
		// 入力場は通常配置の狭い範囲ではなく、均等割付した後の基準位置で読む。
		const edgesOnly = texture([255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
		const distributedEdges = metrics(await effect.render({ text: 'FFF', align: 'distribute', opacity: edgesOnly }), 256);
		close(distributedEdges.area / originalMetrics.area, 2, 0.05, 'distributed input sampling');
		assert(metrics(await effect.render({ text: 'FFF', opacity: edgesOnly }), 256).area === 0, 'natural input sampling');
		checks.push('sampling distributed anchors');
		const rightOnly = texture([0, 0, 0, 255, 255, 255, 255, 255]);
		const leftOnly = texture([255, 255, 255, 255, 0, 0, 0, 255]);
		const both = metrics(await effect.render({ text: 'FF' }), 256);
		const rightOpacity = await effect.render({ text: 'FF', opacity: rightOnly });
		const rightMetrics = metrics(rightOpacity, 256);
		close(rightMetrics.area / both.area, 0.5, 0.01, 'per-character opacity');
		assert(rightMetrics.minX >= 128, 'opacity samples character center');
		equalPixels(await effect.render({ text: 'FF', scale: rightOnly }), rightOpacity);
		checks.push('opacity node', 'scale node');
		const leftVisible = metrics(await effect.render({ text: 'FF', opacity: leftOnly }), 256);
		const movedLeft = metrics(await effect.render({ text: 'FF', opacity: leftOnly, translation: vector([0.6, 0]) }), 256);
		close(movedLeft.area, leftVisible.area, 2, 'sample before translation');
		assert(movedLeft.minX > 128, 'translated glyph must cross field boundary');
		checks.push('stable sampling anchor');
		// 後ろの文字を押す量を、各文字の元の位置で評価する。最終文字自身の値は使わない。
		const leftTracking = texture([64, 0, 0, 255, 0, 0, 0, 255]);
		const rightTracking = texture([0, 0, 0, 255, 64, 0, 0, 255]);
		equalPixels(await effect.render({ text: 'FF', tracking: leftTracking }), await effect.render({ text: 'FF', tracking: scalar(64 / 255) }));
		equalPixels(await effect.render({ text: 'FF', tracking: rightTracking }), await effect.render({ text: 'FF' }));
		equalPixels(await effect.render({ text: 'FFF\nFFF', repetitions: [1, 2], tracking: scalar(spaceRatio) }), await effect.render({ text: 'F F F\nF F F', repetitions: [1, 2] }));
		equalPixels(await effect.render({ text: 'F', repetitions: [3, 1], tracking: scalar(0.2) }), await effect.render({ text: 'F F F', tracking: scalar(0.2) }));
		checks.push('tracking node', 'tracking resets per row');
		// 非一様なTrackingでは両端の画素を維持し、中間の文字だけを移動する。
		// 3文字の場合、先頭側の間隔を増やすと中央が右へ、末尾側なら左へ同量動く。
		const middleOnly = texture([0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
		const distributedEndpoints = await effect.render({ text: 'FFF', align: 'distribute', opacity: edgesOnly });
		for (const [tracking, direction] of [[leftTracking, 1], [rightTracking, -1]] as const) {
			equalPixels(await effect.render({ text: 'FFF', align: 'distribute', opacity: edgesOnly, tracking }), distributedEndpoints);
			equalPixels(await effect.render({ text: 'FFF', align: 'distribute', opacity: middleOnly, tracking }), await effect.render({ text: 'FFF', align: 'distribute', opacity: middleOnly, translation: vector([direction * (64 / 255) * fontSize / 256, 0]) }));
		}
		checks.push('distributed node tracking pins endpoints', 'distributed tracking moves interior characters');
		const distributedBlock = { text: 'F F F\nFFF\nF', align: 'distribute', repetitions: [1, 2], opacity: edgesOnly } as const;
		equalPixels(await effect.render({ ...distributedBlock, tracking: leftTracking }), await effect.render(distributedBlock));
		equalPixels(await effect.render({ text: 'FF', align: 'distribute', tracking: leftTracking }), await effect.render({ text: 'FF', align: 'distribute' }));
		equalPixels(await effect.render({ align: 'distribute', tracking: leftTracking }), original);
		checks.push('distributed multiline endpoint constraints', 'distributed short rows with tracking');
		// 字間を負にして文字が入力場の境界を越えても、Opacityの評価点は元の位置に残る。
		equalPixels(await effect.render({ text: 'FF', opacity: leftOnly, tracking: scalar(-1) }), await effect.render({ text: 'FF', opacity: leftOnly, translation: vector([fontSize / 256, 0]) }));
		checks.push('sampling before tracking');
		assert(metrics(await effect.render({ text: 'F'.repeat(130), size: 0.01, repetitions: [1, 3], tracking: scalar(0.1) }), 256).area > 10, 'long tracking rows');
		checks.push('tracking across long rows');
		const colorInput = texture([128, 0, 0, 128, 0, 128, 0, 128]);
		const fieldColors = await effect.render({ text: 'FF', color: colorInput });
		assert(fieldColors.some((value, index) => index % 4 === 0 && value > 0) && fieldColors.some((value, index) => index % 4 === 1 && value > 0), 'color node');
		assert(fieldColors.every((value, index) => index % 4 !== 2 || value === 0), 'color channels');
		const translationInput = texture([0, 64, 0, 255, 0, 0, 0, 255]);
		const rotationInput = texture([0, 0, 0, 255, 128, 0, 0, 255]);
		assert(metrics(await effect.render({ text: 'FF', translation: translationInput, rotation: rotationInput }), 256).area > 30, 'translation and rotation nodes');
		checks.push('color node', 'translation and rotation nodes');
		const outside = { text: 'F', position: [2, 0] as const, translation: vector([-2, 0]) };
		assert(metrics(await effect.render({ ...outside, opacity: leftOnly.kind === 'texture' ? { ...leftOnly, wrapMode: 'transparent' } : leftOnly }), 256).area === 0, 'transparent sampling outside frame');
		assert(metrics(await effect.render({ ...outside, opacity: rightOnly }), 256).area > 30, 'offscreen base glyph translated into frame');
		checks.push('offscreen glyphs and wrap');
		const overlap = await effect.render({ text: 'F\nF', lineHeight: 0, opacity: scalar(0.5) });
		assert(overlap.every((value, index) => Math.abs(value - (1 - (1 - original[index] / 510) ** 2) * 255) <= 2), 'overlap source-over');
		checks.push('ordered alpha blending');
		for (let mask = 0; mask < 64; mask++) await effect.render({
			translation: (mask & 1) !== 0 ? translationInput : vector([0, 0]), opacity: (mask & 2) !== 0 ? rightOnly : scalar(1),
			scale: (mask & 4) !== 0 ? rightOnly : scalar(1), rotation: (mask & 8) !== 0 ? rotationInput : scalar(0), color: (mask & 16) !== 0 ? colorInput : color([1, 1, 1, 1]),
			tracking: (mask & 32) !== 0 ? leftTracking : scalar(0),
		});
		checks.push('all 64 input variants');
		for (const overrides of [{ text: '' }, { text: ' \n ' }, { size: 0 }]) assert(metrics(await effect.render(overrides), 256).area === 0, 'clear empty output');
		equalPixels(await effect.render(), original);
		checks.push('clear and restore');
		for (const overrides of [{ text: 'NEW', size: 1000 }, { repetitions: [1e9, 1e9] as const }]) {
			let rejected = false;
			try { await effect.render(overrides); } catch { rejected = true; }
			assert(rejected, 'oversized layout must fail');
			equalPixels(await effect.render({ position: [0.5, -0.25] }), await effect.render({ translation: vector([0.5, -0.25]) }));
		}
		checks.push('resource limit recovery');
		for (const format of ['bgra8unorm', 'rgba16float'] as const) {
			const other = createEffect(256, 128, format);
			equalPixels(await other.render(), original);
		}
		checks.push('intermediate formats');
		const fontResponse = await fetch('/font');
		if (fontResponse.ok) {
			await effect.loadFont(await fontResponse.blob());
			assert(metrics(await effect.render(), 256).area > 30, 'loaded font missing');
			checks.push('font file');
		}
		const previewEffect = createEffect(720, 900);
		const field = device.createTexture({ size: [720, 900], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		owned.push(field);
		const fieldData = new Uint8Array(720 * 900 * 4);
		for (let y = 0; y < 900; y++) for (let x = 0; x < 720; x++) {
			const wave = Math.sin(x / 720 * Math.PI * 4 - y / 900 * 5);
			const offset = (y * 720 + x) * 4;
			fieldData.set([Math.round((wave * 0.025 + 0.03) * 255), Math.round((wave * 0.015 + 0.02) * 255), 0, 255], offset);
		}
		device.queue.writeTexture({ texture: field }, fieldData, { bytesPerRow: 720 * 4 }, [720, 900]);
		const pixels = await previewEffect.render({ text: 'TOGETHER', size: 0.025, repetitions: [5, 28], color: color([0.08, 0.16, 0.12, 1]), translation: textureShaderInput(field, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' }) });
		const canvas = new OffscreenCanvas(720, 900);
		const context = canvas.getContext('2d')!;
		context.putImageData(new ImageData(pixels, 720, 900), 0, 0);
		context.globalCompositeOperation = 'destination-over';
		context.fillStyle = '#e8fff0';
		context.fillRect(0, 0, 720, 900);
		const preview = await new Promise<string>(resolve => {
			canvas.convertToBlob({ type: 'image/png' }).then(blob => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result).split(',')[1]);
				reader.readAsDataURL(blob);
			});
		});
		const validation = await device.popErrorScope();
		assert(validation == null, validation?.message ?? 'GPU validation error');
		return { checks, preview };
	} finally {
		for (const effect of effects) effect.dispose();
		for (const resource of owned) resource.destroy();
		device.destroy();
	}
}
