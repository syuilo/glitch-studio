import definition from '../../src/fx/zoomBlur/_def_.ts';
import implementation from '../../src/fx/zoomBlur/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.004) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string, tolerance = 0.004) => {
		assert(actual.length === expected.length, `${label}: length`);
		actual.forEach((value, index) => near(value, expected[index], `${label}[${index}]`, tolerance));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const constantColor = [2, -1, 0.5, 0.5];
	const defaults: Parameters = {
		input: constantShaderInput('color', [4, -2, 1, 0.5]),
		center: [0, 0], strength: scalar(0.3), focusRadius: scalar(0), dispersion: scalar(0),
		dispersionFalloff: scalar(0), bias: scalar(0), highlights: scalar(0), spiral: scalar(0),
		jitter: scalar(0), samples: 32, seed: 0, sizeReference: 'longSide',
	};
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }), vertex: { module: vertex },
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
			pass.setBindGroup(0, device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			return pixels;
		} finally {
			target.destroy();
			buffer.destroy();
		}
	}

	function textureInput(width: number, height: number, values: number[], scalarTexture = false, sampling: Partial<ShaderInputSampling> = {}) {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode: 'linear', fitMode: 'stretch', wrapMode: 'clamp', ...sampling });
	}

	function coordinateImage(width: number, height: number) {
		const longest = Math.max(width, height);
		return Array.from({ length: width * height }, (_, index) => [
			0.5 + (index % width - (width - 1) / 2) / longest * 4,
			-0.25 + ((height - 1) / 2 - Math.floor(index / width)) / longest * 4,
			-2, 0.5,
		]).flat();
	}

	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		disposables.push(() => { instance.dispose(); output.destroy(); });
		return async (overrides: Partial<Parameters> = {}, options: { time?: number; tileSize?: number } = {}) => {
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time: options.time ?? 0, timeDelta: 16,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => {
					const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
					const tileSize = options.tileSize;
					if (tileSize != null) {
						// 実際のタイル描画と同じ全体viewport・Scissorを使う。描画を複数回に
						// 分けても、fragmentの画素番号やJitter位相が変化しないことを確かめる。
						const draw = pass.draw.bind(pass);
						pass.draw = (vertexCount, instanceCount = 1, firstVertex = 0, firstInstance = 0) => {
							for (let y = 0; y < height; y += tileSize) {
								for (let x = 0; x < width; x += tileSize) {
									pass.setScissorRect(x, y, Math.min(tileSize, width - x), Math.min(tileSize, height - y));
									draw(vertexCount, instanceCount, firstVertex, firstInstance);
								}
							}
						};
					}
					return pass;
				},
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

	try {
		// 【強度0では全ての詳細設定にかかわらず元画像を保つ】
		// ぼかしを止めても分散や渦だけが残る誤りと、入力への二重alpha乗算を検出する。
		const render = createEffect(33, 17);
		const coordinateValues = coordinateImage(33, 17);
		const coordinates = textureInput(33, 17, coordinateValues);
		const details = { dispersion: scalar(1), dispersionFalloff: scalar(0.5), bias: scalar(1), highlights: scalar(1), spiral: scalar(1), jitter: scalar(1) };
		const bypass = await render({ input: coordinates, strength: scalar(0), ...details });
		const roundedCoordinates = new Float32Array(new Float16Array(coordinateValues));
		equal(bypass, roundedCoordinates, 'zero strength', 0);
		checks.push('zero strength identity');

		// 【一定色・半透明・HDR・負値を分散込みで保存する】
		// RGBごとの正規化不足やalphaの固定を検出し、サンプル数変更で表が
		// 更新されることも、最小・既定・最大のサンプル数で確認する。
		const constantTexture = textureInput(1, 1, constantColor);
		for (const input of [defaults.input, constantTexture]) {
			for (const samples of [4, 32, 256, 4]) {
				const pixels = await render({ input, strength: scalar(1), center: [1.2, -0.8], samples, ...details });
				pixels.forEach((value, index) => near(value, constantColor[index % 4], 'constant color'));
			}
		}
		const transparent = await render({ input: constantShaderInput('color', [8, -4, 2, 0]), ...details });
		transparent.forEach(value => near(value, 0, 'transparent color', 0));
		checks.push('constant colors alpha HDR and sample table updates');

		// 【既知の4サンプル拡大と中心座標を縦長・横長で照合する】
		// 4点の倍率1,4/3,5/3,2に対する平均を独立に求め、UVの単純加算や
		// 中心の符号・座標換算の誤りを検出する。中心自身は全サンプルが一致する。
		const outerWeight = Math.exp(-0.5 / 0.64);
		const innerWeight = Math.exp(-0.5 / (9 * 0.64));
		const meanInverseScale = (outerWeight * 1.5 + innerWeight * 1.35) / (2 * outerWeight + 2 * innerWeight);
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const longest = Math.max(width, height);
			const input = textureInput(width, height, coordinateImage(width, height));
			const center = [4 / longest, -2 / longest] as const;
			const pixels = await createEffect(width, height)({ input, center, strength: scalar(1), samples: 4 });
			const pixel = (((height - 1) / 2 - 6) * width + (width - 1) / 2 + 8) * 4;
			near(pixels[pixel], 0.5 + (4 + 4 * meanInverseScale) / longest * 4, 'known radial x');
			near(pixels[pixel + 1], -0.25 + (-2 + 8 * meanInverseScale) / longest * 4, 'known radial y');
			const centerPixel = (((height - 1) / 2 + 2) * width + (width - 1) / 2 + 4) * 4;
			near(pixels[centerPixel], 0.5 + 4 / longest * 4, 'fixed center x');
			near(pixels[centerPixel + 1], -0.25 - 2 / longest * 4, 'fixed center y');
		}
		checks.push('known isotropic samples and off-origin center');

		// 【定数とテクスチャの局所パラメータが同じ演算経路になる】
		// 各scalar入力と全入力を接続する構成を比較する。単一画素の場も
		// テクスチャとして扱い、入力種別変更時のpipeline・bindingの切替を検証する。
		const controlValues = { strength: 0.75, focusRadius: 0.0625, dispersion: 0.5, dispersionFalloff: 0.25, bias: -0.5, highlights: 0.25, spiral: -0.5, jitter: 0.75 };
		const controls: Partial<Parameters> = {};
		const textures: Partial<Parameters> = {};
		for (const [name, value] of Object.entries(controlValues)) {
			const key = name as keyof typeof controlValues;
			controls[key] = scalar(value);
			textures[key] = textureInput(1, 1, [value], true);
		}
		const controlled = await render({ input: coordinates, ...controls });
		for (const name of Object.keys(controlValues)) {
			const key = name as keyof typeof controlValues;
			equal(await render({ input: coordinates, ...controls, [key]: textures[key] }), controlled, `${name} texture`);
		}
		equal(await render({ input: coordinates, ...textures }), controlled, 'all spatial controls');
		checks.push('uniform and texture controls');

		// 【局所的な強度は出力位置だけで決まる】
		// 軌跡に沿ってマスクを読み直すと、境界を越えた部分で保護が崩れてしまう。
		const maskValues = Array.from({ length: 33 * 17 }, (_, index) => index % 33 < 16 ? 0 : 1);
		const mask = textureInput(33, 17, maskValues, true, { filterMode: 'nearest' });
		const blurred = await render({ input: coordinates, strength: scalar(1) });
		const local = await render({ input: coordinates, strength: mask });
		local.forEach((value, index) => near(value, (maskValues[Math.floor(index / 4)] === 0 ? bypass : blurred)[index], 'output-local strength'));
		checks.push('output-local strength field');

		// 【保護領域の半径はSize Referenceでだけ換算する】
		// 保護領域の内側は原像、外側は通常のブラーに一致し、出力寸法による
		// 半径換算がCenterや正規化距離へ誤って混入しないことを確認する。
		const focused = await render({ input: coordinates, strength: scalar(1), focusRadius: scalar(0.2) });
		let protectedPixels = 0;
		let blurredPixels = 0;
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) {
				const distance = Math.hypot(x - 16, y - 8) / 33;
				const expected = distance < 0.13 ? bypass : distance > 0.27 ? blurred : null;
				if (expected == null) continue;
				if (distance < 0.13) protectedPixels++; else blurredPixels++;
				for (let channel = 0; channel < 4; channel++) near(focused[(y * 33 + x) * 4 + channel], expected[(y * 33 + x) * 4 + channel], 'focus zone');
			}
		}
		assert(protectedPixels > 0 && blurredPixels > 0, 'both focus regions exercised');
		equal(await render({ input: coordinates, focusRadius: scalar(0.2), sizeReference: 'height', center: [0.2, -0.08] }),
			await render({ input: coordinates, focusRadius: scalar(0.2 * 17 / 33), center: [0.2, -0.08] }), 'focus size reference');
		checks.push('focus dimensions and size reference');

		// 【透明な素材はRGBとalphaを同じ軌跡でぼかす】
		// 分散なしでは一定色のRGB/alpha比を維持し、透明な余白にも半透明の
		// 軌跡が伸びる。分散自体がalphaを着色・不透明化しないことも確認する。
		const silhouette = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => index % 33 < 16 ? constantColor : [0, 0, 0, 0]).flat());
		const silhouetteParams = { input: silhouette, center: [-0.3, 0] as const, strength: scalar(1) };
		const softAlpha = await render(silhouetteParams);
		let hasSoftAlpha = false;
		let hasExtendedAlpha = false;
		for (let index = 0; index < softAlpha.length; index += 4) {
			const alpha = softAlpha[index + 3];
			near(softAlpha[index], alpha * 4, 'premultiplied red');
			near(softAlpha[index + 1], alpha * -2, 'premultiplied green');
			near(softAlpha[index + 2], alpha, 'premultiplied blue');
			if (alpha > 0.01 && alpha < 0.49) hasSoftAlpha = true;
			if (index / 4 % 33 >= 16 && alpha > 0.01) hasExtendedAlpha = true;
		}
		assert(hasSoftAlpha && hasExtendedAlpha, 'alpha streak extends into transparent pixels');
		const dispersedAlpha = await render({ ...silhouetteParams, dispersion: scalar(1) });
		for (let index = 3; index < softAlpha.length; index += 4) near(dispersedAlpha[index], softAlpha[index], 'dispersion preserves alpha', 0);
		checks.push('transparent silhouettes and dispersion alpha');

		// 【分散の符号とFalloffの作用を確認する】
		// 無彩色の勾配で色の並びが反転し、Falloffは中心付近の分散だけを弱める。
		const gray = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = 1 + (index % 33 - 16) / 16;
			return [value, value, value, 1];
		}).flat());
		const spectralParams = { input: gray, strength: scalar(1) };
		const forward = await render({ ...spectralParams, dispersion: scalar(1) });
		const reversed = await render({ ...spectralParams, dispersion: scalar(-1) });
		const peripheral = await render({ ...spectralParams, dispersion: scalar(1), dispersionFalloff: scalar(1) });
		const spectralPixel = (8 * 33 + 24) * 4;
		assert(forward[spectralPixel] > forward[spectralPixel + 2] + 0.02, 'red at near end');
		assert(reversed[spectralPixel] < reversed[spectralPixel + 2] - 0.02, 'reversed spectrum');
		assert(Math.abs(peripheral[spectralPixel] - peripheral[spectralPixel + 2]) < Math.abs(forward[spectralPixel] - forward[spectralPixel + 2]), 'falloff reduces inner dispersion');
		checks.push('spectral order and falloff');

		// 【Highlightsは明るいサンプルだけを強調する】
		// 明度順に単調な重み付けは明るい画素の平均を下げない。負の輝度を
		// 二乗して誤って光源扱いする実装は、負の勾配の比較で検出する。
		const highlighted = await render({ ...spectralParams, highlights: scalar(1) });
		const ordinaryGray = await render(spectralParams);
		assert(highlighted[spectralPixel] > ordinaryGray[spectralPixel] + 0.005, 'positive highlights emphasized');
		const negativeGray = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = -1 - index % 33 / 16;
			return [value, value, value, 1];
		}).flat());
		equal(await render({ input: negativeGray, highlights: scalar(1) }), await render({ input: negativeGray }), 'negative luminance is not a highlight', 0);
		checks.push('highlight emphasis and negative luminance');

		// 【Spiralは等方座標で回転し、符号で巻き方向を変える】
		// 中心の真上では時計回りの見た目に対する参照位置が左へ動く。
		// 軸ごとのUVで回転する実装を、縦長と横長の同じ共通位置で照合する。
		let spiralReference: number | null = null;
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const spiralRender = createEffect(width, height);
			const input = textureInput(width, height, coordinateImage(width, height));
			const clockwise = await spiralRender({ input, strength: scalar(1), spiral: scalar(1) });
			const counterclockwise = await spiralRender({ input, strength: scalar(1), spiral: scalar(-1) });
			const pixel = (((height - 1) / 2 - 8) * width + (width - 1) / 2) * 4;
			assert(clockwise[pixel] < 0.48 && counterclockwise[pixel] > 0.52, 'spiral direction');
			if (spiralReference != null) near(clockwise[pixel], spiralReference, 'isotropic spiral');
			spiralReference = clockwise[pixel];
		}
		checks.push('clockwise isotropic spiral');

		// 【入力接続の範囲外とFitを維持する】
		// 画面外中心での参照は独自にclampせず、同じ画像のRepeatとTransparentを
		// 区別する。Containの余白も接続側で処理されることを確認する。
		const repeated = textureInput(4, 4, Array.from({ length: 16 }, () => constantColor).flat(), false, { wrapMode: 'repeat', filterMode: 'nearest' });
		if (repeated.kind !== 'texture') throw new Error('Expected a texture input');
		const emptyOutside = textureShaderInput(repeated.texture, { wrapMode: 'transparent', filterMode: 'nearest', fitMode: 'stretch' });
		const outsideParams = { center: [2, 2] as const, strength: scalar(1), bias: scalar(-1), samples: 4 };
		const repeatOutside = await render({ input: repeated, ...outsideParams });
		const transparentOutside = await render({ input: emptyOutside, ...outsideParams });
		repeatOutside.forEach((value, index) => near(value, constantColor[index % 4], 'repeat outside'));
		transparentOutside.forEach(value => near(value, 0, 'transparent outside', 0));
		const contained = textureShaderInput(repeated.texture, { wrapMode: 'transparent', filterMode: 'nearest', fitMode: 'contain' });
		const containPixels = await createEffect(8, 4)({ input: contained, strength: scalar(0) });
		containPixels.forEach((value, index) => near(value, Math.floor(index / 4) % 8 >= 2 && Math.floor(index / 4) % 8 < 6 ? constantColor[index % 4] : 0, 'contain sampling', 0));
		checks.push('input wrap fit and filtering');

		// 【範囲外の値とサンプル数の変更でも有限な結果を返す】
		// UIを経由しない式・場の値も制限し、Bias/Jitterの極値で分母が0に
		// ならないことと、サンプル表を別の数へ更新して戻せることを確認する。
		const bounded = { input: coordinates, strength: scalar(1), focusRadius: scalar(0), dispersion: scalar(-1), dispersionFalloff: scalar(1), bias: scalar(1), highlights: scalar(1), spiral: scalar(-1), jitter: scalar(1), samples: 4 };
		const unbounded = { input: coordinates, strength: scalar(9), focusRadius: scalar(-1), dispersion: scalar(-9), dispersionFalloff: scalar(9), bias: scalar(9), highlights: scalar(9), spiral: scalar(-9), jitter: scalar(9), samples: -1 };
		const boundedPixels = await render(bounded);
		equal(await render(unbounded), boundedPixels, 'parameter bounds', 0);
		await render({ ...bounded, samples: 64 });
		equal(await render(bounded), boundedPixels, 'sample table restored', 0);
		equal(await render({ input: coordinates, samples: 4.6 }), await render({ input: coordinates, samples: 5 }), 'sample rounding', 0);
		equal(await render({ input: coordinates, samples: 1000 }), await render({ input: coordinates, samples: 256 }), 'sample upper bound', 0);
		equal(await render({ input: coordinates, strength: scalar(-1) }), bypass, 'negative strength', 0);
		checks.push('parameter bounds and sample table restoration');

		// 【Seed・時刻・タイルの有無がJitterの再現性を壊さない】
		// 高周波の入力と最小サンプル数で位相差を可視化し、Seed変更の作用と
		// 時間非依存・Scissor分割の一致・Jitter無効時のSeed非依存を確認する。
		const checker = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = (index % 33 + Math.floor(index / 33)) % 2;
			return [value * 2, -value, value * 0.5, 0.5];
		}).flat());
		const jitterParams = { ...bounded, input: checker, seed: 123 };
		const jittered = await render(jitterParams);
		equal(await render(jitterParams, { time: 100 }), jittered, 'time independent jitter', 0);
		equal(await render(jitterParams, { tileSize: 7 }), jittered, 'tiled jitter', 0);
		const otherSeed = await render({ ...jitterParams, seed: 124 });
		assert(otherSeed.some((value, index) => Math.abs(value - jittered[index]) > 0.005), 'seed changes jitter');
		equal(await render({ ...jitterParams, jitter: scalar(0) }), await render({ ...jitterParams, jitter: scalar(0), seed: 124 }), 'inactive jitter ignores seed', 0);
		checks.push('seed time and tile determinism');

		// 【解像度を変更しても対応する共通位置の像は一致する】
		// 同じ入力画像を3倍解像度へ描画し、寸法換算や回転へ画素数が混入しないことを確認する。
		const resolutionParams = { input: coordinates, ...controls, jitter: scalar(0), center: [0.13, -0.07] as const };
		const low = await render(resolutionParams);
		const high = await createEffect(99, 51)(resolutionParams);
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) {
				for (let channel = 0; channel < 4; channel++) near(low[(y * 33 + x) * 4 + channel], high[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], 'resolution independent');
			}
		}
		checks.push('resolution independent paths');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
