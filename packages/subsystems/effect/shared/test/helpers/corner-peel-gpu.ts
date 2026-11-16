import definition from '../../src/fx/cornerPeel/_def_.ts';
import implementation from '../../src/fx/cornerPeel/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run(includePreview = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.003) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
	const defaults: Parameters = {
		inputA: constantShaderInput('color', [4, -2, 1, 0.5]),
		inputB: constantShaderInput('color', [-2, 4, 0, 0.25]),
		progress: scalar(0.5), corner: 'topRight', curlRadius: 0.08, sizeReference: 'longSide',
		backMode: 'source', backColor: constantShaderInput('color', [0.92, 0.90, 0.84, 1]),
		backInput: constantShaderInput('color', [0, 0, 0, 0]),
		shadowOpacity: 0.35, shadowSoftness: 0.02, shading: 0.6,
	};
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});

	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			return pixels;
		} finally { target.destroy(); buffer.destroy(); }
	}

	function textureInput(width: number, height: number, values: number[], scalarTexture = false, filterMode: 'linear' | 'nearest' = 'linear') {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode, fitMode: 'stretch', wrapMode: 'clamp' });
	}

	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		disposables.push(() => { instance.dispose(); output.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			device.queue.submit([encoder.finish()]);
			const pixels = await read(output);
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite output');
			return pixels;
		};
	}

	const pixelAt = (pixels: Float32Array, width: number, x: number, y: number) => pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
	const colorNear = (pixel: Float32Array, expected: readonly number[] | Float32Array, label: string, tolerance = 0.003) => expected.forEach((value, channel) => near(pixel[channel], value, label, tolerance));
	const coordinateTexture = (width: number, height: number) => textureInput(width, height,
		Array.from({ length: width * height }, (_, index) => [(index % width + 0.5) / width, 1 - (Math.floor(index / width) + 0.5) / height, 0.25, 1]).flat());

	const corners = ['topRight', 'topLeft', 'bottomRight', 'bottomLeft'] as const;
	// 検証側は区間の組み立てを共有せず、各面の候補を逆投影し、矩形内で最も高い面を選ぶ。
	// 材料座標の取り違えと、紙の側辺を無限に延ばしてしまう実装を別の方法で検出する。
	function surfaceAt(width: number, height: number, corner: Parameters['corner'], progress: number, radius: number, x: number, y: number) {
		const longestSide = Math.max(width, height);
		const half = [width / longestSide / 2, height / longestSide / 2];
		const diagonal = Math.hypot(width, height);
		const axis = [(corner === 'topRight' || corner === 'bottomRight' ? width : -width) / diagonal,
			(corner === 'topRight' || corner === 'topLeft' ? height : -height) / diagonal];
		const point = [(x + 0.5 - width / 2) / longestSide, (height / 2 - y - 0.5) / longestSide];
		const pageLength = diagonal / longestSide;
		const coordinate = point[0] * axis[0] + point[1] * axis[1] + pageLength / 2;
		const crease = pageLength * (1 - progress) - radius * progress;
		type Surface = { kind: number; height: number; color: number[]; angle: number };
		let visible: Surface | null = null;
		const candidate = (kind: number, material: number, height: number, angle: number) => {
			const source = point.map((value, index) => value + axis[index] * (material - coordinate));
			if (source.some((value, index) => Math.abs(value) > half[index] + 1e-10)) return;
			if (visible != null && visible.height > height) return;
			visible = { kind, height, color: [source[0] / (2 * half[0]) + 0.5, source[1] / (2 * half[1]) + 0.5, 0.25, 1], angle };
		};
		if (coordinate <= crease) candidate(0, coordinate, 0, 0);
		const ratio = (coordinate - crease) / radius;
		if (ratio >= 0 && ratio <= 1) {
			const frontAngle = Math.asin(ratio);
			for (const [kind, angle] of [[1, frontAngle], [2, Math.PI - frontAngle]]) candidate(kind, crease + radius * angle, radius * (1 - Math.cos(angle)), angle);
		}
		const reflected = 2 * crease + Math.PI * radius - coordinate;
		if (reflected >= crease + Math.PI * radius) candidate(3, reflected, 2 * radius, Math.PI);
		return visible as Surface | null;
	}

	try {
		// 【四隅・裏面モード・半径を変えてもA/Bへ連続する】
		// 半透明HDRの定数色で、端点だけ差し替えて直前に紙や影が残る不連続を検出する。
		const render = createEffect(65, 33);
		for (const corner of corners) {
			for (const backMode of ['source', 'color', 'input'] as const) {
				for (const curlRadius of [0, 0.08, 2]) {
					for (const progress of [-1, 0, 0.000001, 0.999999, 1, 2]) {
						const pixels = await render({ corner, backMode, curlRadius, progress: scalar(progress), shadowOpacity: 1, shadowSoftness: 0.4, shading: 1 });
						const expected = progress < 0.5 ? colorA : colorB;
						pixels.forEach((value, index) => near(value, expected[index % 4], 'continuous endpoint', progress <= 0 || progress >= 1 ? 0 : 0.005));
					}
				}
			}
		}
		checks.push('continuous endpoints across corners modes and radii');

		// 【静止した表面と端点でテクスチャの細部を保存する】
		// 定数色では気づけない参照位置のずれや、AAによる画像全体のぼけを市松模様で検出する。
		for (const [width, height] of [[33, 17], [17, 33]]) {
			const sample = createEffect(width, height);
			const checker = textureInput(width, height, Array.from({ length: width * height }, (_, i) => [i % 2, 1 - i % 2, 0.25, 1]).flat());
			for (const corner of corners) {
				for (const endpoint of [0, 1]) {
					const exact = await sample({ inputA: checker, inputB: checker, corner, progress: scalar(endpoint) });
					const close = await sample({ inputA: checker, inputB: checker, corner, progress: scalar(endpoint === 0 ? 0.000001 : 0.999999) });
					equal(close, exact, 'textured endpoint');
				}
			}
		}
		checks.push('textured endpoints without blur');

		// 【有限の紙の側辺・斜めの鏡像・前後関係と陰影】
		// 縦長・横長・正方形を検証し、UVの固定45度回転や側辺を無視した近似を検出する。
		const surfacesChecked = new Set<number>();
		let outsideChecked = 0;
		for (const [width, height] of [[65, 33], [33, 65], [65, 65]]) {
			const sample = createEffect(width, height);
			const inputA = coordinateTexture(width, height);
			for (const corner of corners) {
				for (const progress of [0.25, 0.5, 0.75]) {
					const pixels = await sample({ inputA, backInput: inputA, backMode: 'input', corner, progress: scalar(progress), shading: 1, shadowOpacity: 0 });
					for (let y = 2; y < height - 2; y += 3) {
						for (let x = 2; x < width - 2; x += 3) {
							const surface = surfaceAt(width, height, corner, progress, 0.08, x, y);
							const neighborhood = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([dx, dy]) => surfaceAt(width, height, corner, progress, 0.08, x + dx, y + dy));
							if (surface == null) {
								if (neighborhood.every(value => value == null)) {
									colorNear(pixelAt(pixels, width, x, y), colorB, 'finite paper background');
									outsideChecked++;
								}
								continue;
							}
							if (neighborhood.some(value => value == null || value.kind !== surface.kind || Math.abs(Math.cos(value.angle)) < 0.4)) continue;
							const light = 1 - 0.45 * (1 - Math.abs(Math.cos(surface.angle)));
							colorNear(pixelAt(pixels, width, x, y), surface.color.map((value, channel) => channel < 3 ? value * light : value), 'diagonal material and lighting', 0.006);
							surfacesChecked.add(surface.kind);
						}
					}
				}
			}
		}
		assert(surfacesChecked.size === 4 && outsideChecked > 100, 'all surfaces and clipped background checked');
		checks.push('finite diagonal geometry reflection occlusion and lighting');

		// 【紙の斜め外縁と折り返しを面積でAAする】
		// 高密度の独立した点サンプルと照合し、二重被覆・細い裏面の欠落・側辺の段差を検出する。
		const aaWidth = 49;
		const aaHeight = 31;
		const antialias = createEffect(aaWidth, aaHeight);
		const white = constantShaderInput('color', [1, 1, 1, 1]);
		const transparent = constantShaderInput('color', [0, 0, 0, 0]);
		let boundariesChecked = 0;
		for (const progress of [0.25, 0.5, 0.75]) {
			const pixels = await antialias({ inputA: white, inputB: transparent, backMode: 'color', backColor: white, progress: scalar(progress), shading: 0, shadowOpacity: 0 });
			for (let y = 1; y < aaHeight - 1; y++) {
				for (let x = 1; x < aaWidth - 1; x++) {
					const covered = [[-0.5, -0.5], [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5]].map(([dx, dy]) => surfaceAt(aaWidth, aaHeight, 'topRight', progress, 0.08, x + dx, y + dy) != null);
					if (covered.every(value => value === covered[0])) continue;
					let coverage = 0;
					for (let sy = 0; sy < 24; sy++) {
						for (let sx = 0; sx < 24; sx++) {
							if (surfaceAt(aaWidth, aaHeight, 'topRight', progress, 0.08, x + (sx + 0.5) / 24 - 0.5, y + (sy + 0.5) / 24 - 0.5) != null) coverage += 1 / (24 * 24);
						}
					}
					colorNear(pixelAt(pixels, aaWidth, x, y), [coverage, coverage, coverage, coverage], 'edge area coverage', 0.035);
					boundariesChecked++;
				}
			}
		}
		assert(boundariesChecked > 30, 'diagonal boundaries checked');
		checks.push('antialias coverage against dense independent samples');

		// 【裏面の各モードと透明な紙の置換】
		// 色や別画像のalphaを使用し、SourceのみAのalphaを保存する規約を検証する。
		const backPixel = (() => {
			for (let y = 2; y < 31; y++) {
				for (let x = 2; x < 63; x++) {
					if ([[-1, -1], [-1, 1], [1, -1], [1, 1]].every(([dx, dy]) => surfaceAt(65, 33, 'topRight', 0.5, 0.08, x + dx, y + dy)?.kind === 3)) return { x, y };
				}
			}
			throw new Error('No interior back pixel');
		})();
		const paper = constantShaderInput('color', [0.8, 0.4, 0.2, 0.5]);
		const fixedBack = constantShaderInput('color', [4, -2, 1, 0.75]);
		for (const backMode of ['source', 'color', 'input'] as const) {
			const pixels = await render({ backMode, backColor: paper, backInput: fixedBack, shading: 0, shadowOpacity: 0 });
			const expected = backMode === 'source' ? [2 * 0.65 + 0.4 * 0.35, -0.65 + 0.2 * 0.35, 0.5 * 0.65 + 0.1 * 0.35, 0.5]
				: backMode === 'color' ? [0.4, 0.2, 0.1, 0.5] : [3, -1.5, 0.75, 0.75];
			colorNear(pixelAt(pixels, 65, backPixel.x, backPixel.y), expected, 'back mode and premultiplication');
		}
		const transparentPage = await render({ inputA: transparent, backMode: 'source', shading: 0, shadowOpacity: 0 });
		colorNear(pixelAt(transparentPage, 65, backPixel.x, backPixel.y), [0, 0, 0, 0], 'transparent paper replaces background');
		checks.push('back modes premultiplied HDR and transparent replacement');

		// 【影はBのRGBだけを減光し、透明なAは影を落とさない】
		// 影によるalpha増加や形状の変化、透明ページの黒い縁を防ぐ。
		const shadowBase = { inputA: white, inputB: white, backMode: 'color' as const, backColor: white, shading: 0 };
		const unshadowed = await render({ ...shadowBase, shadowOpacity: 0 });
		const shadowed = await render({ ...shadowBase, shadowOpacity: 1 });
		let darkerPixels = 0;
		shadowed.forEach((value, index) => {
			if (index % 4 === 3) near(value, unshadowed[index], 'shadow alpha');
			else if (value < unshadowed[index] - 0.01) darkerPixels++;
		});
		assert(darkerPixels > 10, 'visible cast shadow');
		equal(await render({ ...shadowBase, inputA: transparent, shadowOpacity: 1 }), await render({ ...shadowBase, inputA: transparent, shadowOpacity: 0 }), 'transparent caster');
		checks.push('shadow RGB and alpha');

		// 【接続された進捗・裏面色・裏面画像を評価する】
		// 定数uniformだけを処理してしまう実装と、テクスチャの進捗を一様とみなす誤りを検出する。
		const progressValues = Array.from({ length: 65 * 33 }, (_, index) => index % 65 < 32 ? 0 : 1);
		const localProgress = await render({ progress: textureInput(65, 33, progressValues, true, 'nearest') });
		localProgress.forEach((value, index) => near(value, (Math.floor(index / 4) % 65 < 32 ? colorA : colorB)[index % 4], 'local progress', 0));
		const colorPattern = coordinateTexture(65, 33);
		equal(await render({ backMode: 'color', backColor: colorPattern }), await render({ backMode: 'input', backInput: colorPattern }), 'back image bindings');
		checks.push('texture parameters and spatial progress');

		// 【寸法基準とレンダリング時刻は紙の座標や軌道を変えない】
		// Size Referenceの換算を半径と影幅へだけ適用し、スクラブでも再現可能にする。
		const fixed = await render();
		equal(fixed, await render({}, 123.4), 'time independent');
		equal(fixed, await render({ sizeReference: 'shortSide', curlRadius: 0.08 * 65 / 33, shadowSoftness: 0.02 * 65 / 33 }), 'size reference conversion');
		const highResolution = await createEffect(195, 99)({ shading: 0, shadowOpacity: 0, backMode: 'color', backColor: white });
		const lowResolution = await render({ shading: 0, shadowOpacity: 0, backMode: 'color', backColor: white });
		for (let y = 1; y < 32; y++) {
			for (let x = 1; x < 64; x++) {
				const surface = surfaceAt(65, 33, 'topRight', 0.5, 0.08, x, y);
				if ([[-1, -1], [-1, 1], [1, -1], [1, 1]].some(([dx, dy]) => surfaceAt(65, 33, 'topRight', 0.5, 0.08, x + dx, y + dy)?.kind !== surface?.kind)) continue;
				colorNear(pixelAt(highResolution, 195, x * 3 + 1, y * 3 + 1), pixelAt(lowResolution, 65, x, y), 'resolution invariance');
			}
		}
		for (const [width, height] of [[1, 1], [1, 127], [127, 1]]) {
			const sample = createEffect(width, height);
			for (const corner of corners) await sample({ corner, curlRadius: 0 });
		}
		checks.push('size reference resolution time and extreme aspect ratios');

		let preview: string | null = null;
		if (includePreview) {
			// 手動QA用。数値テストと同じGPU出力を使い、見た目だけ別の実装へ置き換えない。
			const width = 240;
			const height = 160;
			const makePage = (second: boolean) => {
				const canvas = new OffscreenCanvas(width, height);
				const context = canvas.getContext('2d')!;
				context.fillStyle = second ? '#143d66' : '#f7ead1'; context.fillRect(0, 0, width, height);
				context.fillStyle = second ? '#54dbca' : '#bc4134'; context.fillRect(12, 12, width - 24, 34);
				context.font = 'bold 22px sans-serif'; context.fillStyle = second ? '#143d66' : '#fff8e9';
				context.fillText(second ? 'PAGE B' : 'PAGE A', 24, 37);
				context.font = '18px sans-serif'; context.fillStyle = second ? '#ccf2ef' : '#403b31';
				context.fillText('1   2   3   4   5', 25, 82);
				context.fillText('6   7   8   9   0', 25, 112);
				context.fillRect(24, 132, 135, 3);
				const pixels = context.getImageData(0, 0, width, height).data;
				const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
				return textureInput(width, height, Array.from(pixels, (value, index) => index % 4 === 3 ? value / 255 : linear(value / 255)));
			};
			const inputA = makePage(false);
			const inputB = makePage(true);
			const sample = createEffect(width, height);
			const canvas = new OffscreenCanvas(width * 5, (height + 28) * 4);
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#24272c'; context.fillRect(0, 0, canvas.width, canvas.height);
			const srgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
			for (const [row, corner] of (['topRight', 'topLeft', 'bottomRight', 'bottomLeft'] as const).entries()) {
				for (const [column, progress] of [0, 0.25, 0.5, 0.75, 1].entries()) {
					const pixels = await sample({ inputA, inputB, corner, progress: scalar(progress) });
					const encoded = Uint8ClampedArray.from(pixels, (value, index) => 255 * (index % 4 === 3 ? value : srgb(Math.max(0, value))));
					context.putImageData(new ImageData(encoded, width, height), column * width, row * (height + 28) + 28);
					context.fillStyle = '#ffffff'; context.font = '13px sans-serif';
					context.fillText(`${corner} / ${progress}`, column * width + 8, row * (height + 28) + 19);
				}
			}
			const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
			preview = btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''));
		}
		return { checks, preview };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
