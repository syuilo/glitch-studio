import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/angularBlur/_def_.ts';
import implementationNative from '../../src/fx/angularBlur/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;

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
		center: [0, 0], angle: scalar(definition.paramDefs.angle.defaultValue), focusRadius: scalar(0),
		dispersion: scalar(0), dispersionFalloff: scalar(0), bias: scalar(0), highlights: scalar(0),
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
		const output = implementation.createTexture('output', { wgpu, resolution });
		const instance = implementation.place(wgpu, resolution);
		disposables.push(() => { instance.dispose(); output.destroy(); });
		return async (overrides: Partial<Parameters> = {}, options: { time?: number; tileSize?: number } = {}) => {
			const encoder = device.createCommandEncoder();
			const beginPass = encoder.beginRenderPass.bind(encoder);
			encoder.beginRenderPass = descriptor => {
				const pass = beginPass(descriptor);
				const tileSize = options.tileSize;
					if (tileSize != null) {
						// 全体viewportのままScissorで分割し、画素番号とJitter位相の一致を確認する。
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
			};
			await instance.draw({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time: options.time ?? 0, timeDelta: 16,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
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
		// 【角度0は詳細設定にかかわらず元画像へ戻る】
		// 回転を止めても色分散だけが残る誤りや、二重alpha乗算を検出する。
		const render = createEffect(33, 17);
		const coordinateValues = coordinateImage(33, 17);
		const coordinates = textureInput(33, 17, coordinateValues);
		const details = { dispersion: scalar(1), dispersionFalloff: scalar(0.5), bias: scalar(1), highlights: scalar(1), jitter: scalar(1) };
		const bypass = await render({ input: coordinates, angle: scalar(0), ...details });
		equal(bypass, new Float32Array(new Float16Array(coordinateValues)), 'zero angle', 0);
		checks.push('zero angle identity');

		// 【一定色・半透明・HDR・負値を保存する】
		// 分散の正規化不足とalphaの固定を検出し、最小・既定・最大のサンプル数を通す。
		const constantTexture = textureInput(1, 1, constantColor);
		for (const input of [defaults.input, constantTexture]) {
			for (const samples of [4, 32, 256, 4]) {
				const pixels = await render({ input, angle: scalar(1), center: [1.2, -0.8], samples, ...details });
				pixels.forEach((value, index) => near(value, constantColor[index % 4], 'constant color'));
			}
		}
		const transparent = await render({ input: constantShaderInput('color', [8, -4, 2, 0]), ...details });
		transparent.forEach(value => near(value, 0, 'transparent color', 0));
		checks.push('constant colors alpha HDR and sample counts');

		// 【90度の4点回転と片側Biasを既知の座標から照合する】
		// 対称な±45度・±15度の平均と、片側の0度・0度・30度・90度の平均を独立に求める。
		// 回転角のturn換算、中心の符号、Biasの折り畳み、縦横比補正をまとめて検出する。
		const outerWeight = Math.exp(-0.5 / 0.64);
		const innerWeight = Math.exp(-0.5 / (9 * 0.64));
		const weightSum = 2 * (outerWeight + innerWeight);
		const symmetricCosine = (2 * outerWeight * Math.SQRT1_2 + 2 * innerWeight * Math.cos(Math.PI / 12)) / weightSum;
		const biasedCosine = (outerWeight + innerWeight * (1 + Math.sqrt(3) / 2)) / weightSum;
		const biasedSine = (outerWeight + innerWeight / 2) / weightSum;
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const longest = Math.max(width, height);
			const input = textureInput(width, height, coordinateImage(width, height));
			const center = [4 / longest, -2 / longest] as const;
			const orbitRender = createEffect(width, height);
			const pixels = await orbitRender({ input, center, angle: scalar(0.25), samples: 4 });
			const pixel = (((height - 1) / 2 - 6) * width + (width - 1) / 2 + 8) * 4;
			near(pixels[pixel], 0.5 + (4 + 4 * symmetricCosine) / longest * 4, 'known symmetric x');
			near(pixels[pixel + 1], -0.25 + (-2 + 8 * symmetricCosine) / longest * 4, 'known symmetric y');
			const centerPixel = (((height - 1) / 2 + 2) * width + (width - 1) / 2 + 4) * 4;
			near(pixels[centerPixel], 0.5 + 4 / longest * 4, 'fixed center x');
			near(pixels[centerPixel + 1], -0.25 - 2 / longest * 4, 'fixed center y');
			for (const bias of [-1, 1]) {
				const biased = await orbitRender({ input, center, angle: scalar(0.25), samples: 4, bias: scalar(bias) });
				const biasedPixel = (((height - 1) / 2 + 2) * width + (width - 1) / 2 + 12) * 4;
				near(biased[biasedPixel], 0.5 + (4 + 8 * biasedCosine) / longest * 4, 'known biased x');
				near(biased[biasedPixel + 1], -0.25 + (-2 + bias * 8 * biasedSine) / longest * 4, 'known biased y');
			}
		}
		checks.push('known arc samples center bias and aspect ratio');

		// 【回転によって中心からの距離が変わらない】
		// 距離の二乗で作った画像では、同じ円周上の全サンプルが同じ値になる。
		// 直線状・拡大型のぼかしや、UVで回転して楕円になる実装を検出する。
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const longest = Math.max(width, height);
			const radial = textureInput(width, height, Array.from({ length: width * height }, (_, index) => {
				const x = (index % width - (width - 1) / 2) / longest;
				const y = ((height - 1) / 2 - Math.floor(index / width)) / longest;
				return [(x * x + y * y) * 20, 0, 0, 1];
			}).flat());
			const radialPixels = await createEffect(width, height)({ input: radial, angle: scalar(1), bias: scalar(0.7), jitter: scalar(1), samples: 64 });
			const pixel = (((height - 1) / 2 - 4) * width + (width - 1) / 2 + 6) * 4;
			near(radialPixels[pixel], (6 * 6 + 4 * 4) / (longest * longest) * 20, 'constant orbit radius');
		}
		checks.push('preserved orbit radius');

		// 【各scalar入力の定数・テクスチャと局所的な角度を検証する】
		// 全入力を接続する構成も確認し、出力位置の角度場を途中のサンプル位置で
		// 読み直してマスク境界を崩してしまう実装を検出する。
		const controlValues = { angle: 0.125, focusRadius: 0.0625, dispersion: 0.5, dispersionFalloff: 0.25, bias: -0.5, highlights: 0.25, jitter: 0.75 };
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
		const angles = Array.from({ length: 33 * 17 }, (_, index) => index % 33 < 16 ? 0 : 0.25);
		const angleField = textureInput(33, 17, angles, true, { filterMode: 'nearest' });
		const blurred = await render({ input: coordinates, angle: scalar(0.25) });
		const local = await render({ input: coordinates, angle: angleField });
		local.forEach((value, index) => near(value, (angles[Math.floor(index / 4)] === 0 ? bypass : blurred)[index], 'output-local angle'));
		checks.push('uniform texture and output-local controls');

		// 【Focusの保護範囲とSize Referenceを維持する】
		// 内側は原像、外側は通常ブラーに一致し、保護半径の換算を中心からの
		// 最遠距離や回転角へ混ぜないことを確認する。
		const focused = await render({ input: coordinates, angle: scalar(0.25), focusRadius: scalar(0.2) });
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
		checks.push('focus zones and size reference');

		// 【半透明の輪郭も円弧に沿って伸びる】
		// 分散なしではRGB/alpha比を維持し、分散を加えてもalphaを着色・固定しない。
		const silhouette = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => index % 33 < 16 ? constantColor : [0, 0, 0, 0]).flat());
		const silhouetteParams = { input: silhouette, angle: scalar(0.25) };
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
		checks.push('transparent arcs and dispersion alpha');

		// 【分散の向きと距離減衰を検証する】
		// 上へ明るくなる無彩色の画像を使い、右側の円弧で赤から青への重みの並びを照合する。
		const gray = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = 1 + (8 - Math.floor(index / 33)) / 8;
			return [value, value, value, 1];
		}).flat());
		const spectralParams = { input: gray, angle: scalar(0.25) };
		const forward = await render({ ...spectralParams, dispersion: scalar(1) });
		const reversed = await render({ ...spectralParams, dispersion: scalar(-1) });
		const peripheral = await render({ ...spectralParams, dispersion: scalar(1), dispersionFalloff: scalar(1) });
		const spectralPixel = (8 * 33 + 24) * 4;
		assert(forward[spectralPixel] < forward[spectralPixel + 2] - 0.02, 'red at negative-angle end');
		assert(reversed[spectralPixel] > reversed[spectralPixel + 2] + 0.02, 'reversed spectrum');
		assert(Math.abs(peripheral[spectralPixel] - peripheral[spectralPixel + 2]) < Math.abs(forward[spectralPixel] - forward[spectralPixel + 2]), 'falloff reduces inner dispersion');
		checks.push('spectral order and falloff');

		// 【Highlightsは明るいサンプルだけを強調する】
		// 負の輝度を二乗して光源扱いする誤りと、入力の負値をclampする誤りを検出する。
		const highlighted = await render({ ...spectralParams, highlights: scalar(1) });
		const ordinaryGray = await render(spectralParams);
		assert(highlighted[spectralPixel] > ordinaryGray[spectralPixel] + 0.01, 'positive highlights emphasized');
		const negativeGray = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = -1 - Math.floor(index / 33) / 8;
			return [value, value, value, 1];
		}).flat());
		equal(await render({ input: negativeGray, angle: scalar(0.25), highlights: scalar(1) }),
			await render({ input: negativeGray, angle: scalar(0.25) }), 'negative luminance is not a highlight', 0);
		checks.push('highlight emphasis and negative luminance');

		// 【回転先が画面外でも接続のWrapとFitを適用する】
		// 画面外中心で同じ画像へRepeatとTransparentを適用し、独自の端延長を検出する。
		const repeated = textureInput(4, 4, Array.from({ length: 16 }, () => constantColor).flat(), false, { wrapMode: 'repeat', filterMode: 'nearest' });
		if (repeated.kind !== 'texture') throw new Error('Expected a texture input');
		const emptyOutside = textureShaderInput(repeated.texture, { wrapMode: 'transparent', filterMode: 'nearest', fitMode: 'stretch' });
		const outsideParams = { center: [8, 8] as const, angle: scalar(0.25), samples: 4 };
		const repeatOutside = await render({ input: repeated, ...outsideParams });
		const transparentOutside = await render({ input: emptyOutside, ...outsideParams });
		repeatOutside.forEach((value, index) => near(value, constantColor[index % 4], 'repeat outside'));
		transparentOutside.forEach(value => near(value, 0, 'transparent outside', 0));
		const contained = textureShaderInput(repeated.texture, { wrapMode: 'transparent', filterMode: 'nearest', fitMode: 'contain' });
		const containPixels = await createEffect(8, 4)({ input: contained, angle: scalar(0) });
		containPixels.forEach((value, index) => near(value, Math.floor(index / 4) % 8 >= 2 && Math.floor(index / 4) % 8 < 6 ? constantColor[index % 4] : 0, 'contain sampling', 0));
		checks.push('input wrap fit and filtering');

		// 【1周のぼかしは0へ折り返さず、範囲外の値を制限する】
		// Angleは方向ではなく範囲なので1turnも意味を持つ。Samplesの表を別の数へ
		// 更新してから戻した結果も照合し、古い表の再利用を検出する。
		const bounded = { input: coordinates, angle: scalar(1), focusRadius: scalar(0), dispersion: scalar(-1), dispersionFalloff: scalar(1), bias: scalar(1), highlights: scalar(1), jitter: scalar(1), samples: 4 };
		const unbounded = { input: coordinates, angle: scalar(9), focusRadius: scalar(-1), dispersion: scalar(-9), dispersionFalloff: scalar(9), bias: scalar(9), highlights: scalar(9), jitter: scalar(9), samples: -1 };
		const boundedPixels = await render(bounded);
		assert(boundedPixels.some((value, index) => Math.abs(value - bypass[index]) > 0.05), 'one turn remains blurred');
		equal(await render(unbounded), boundedPixels, 'parameter bounds', 0);
		await render({ ...bounded, samples: 64 });
		equal(await render(bounded), boundedPixels, 'sample table restored', 0);
		equal(await render({ input: coordinates, samples: 4.6 }), await render({ input: coordinates, samples: 5 }), 'sample rounding', 0);
		equal(await render({ input: coordinates, samples: 1000 }), await render({ input: coordinates, samples: 256 }), 'sample upper bound', 0);
		equal(await render({ input: coordinates, angle: scalar(-1) }), bypass, 'negative angle', 0);
		checks.push('full turn parameter bounds and table restoration');

		// 【JitterはSeedで変わり、時刻とタイルには依存しない】
		// 位相差が見える高周波画像で最小サンプル数を使い、分割描画も画素単位で比較する。
		const checker = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = (index % 33 + Math.floor(index / 33)) % 2;
			return [value * 2, -value, value * 0.5, 0.5];
		}).flat());
		const jitterParams = { ...bounded, input: checker, angle: scalar(0.5), seed: 123 };
		const jittered = await render(jitterParams);
		equal(await render(jitterParams, { time: 100 }), jittered, 'time independent jitter', 0);
		equal(await render(jitterParams, { tileSize: 7 }), jittered, 'tiled jitter', 0);
		const otherSeed = await render({ ...jitterParams, seed: 124 });
		assert(otherSeed.some((value, index) => Math.abs(value - jittered[index]) > 0.005), 'seed changes jitter');
		equal(await render({ ...jitterParams, jitter: scalar(0) }), await render({ ...jitterParams, jitter: scalar(0), seed: 124 }), 'inactive jitter ignores seed', 0);
		checks.push('seed time and tile determinism');

		// 【解像度を変えても同じ共通位置の円弧が一致する】
		// 固定した入力を3倍解像度へ描き、角度・中心・Focusの寸法換算に画素数が混入しないか調べる。
		const resolutionParams = { input: coordinates, ...controls, jitter: scalar(0), center: [0.13, -0.07] as const };
		const low = await render(resolutionParams);
		const high = await createEffect(99, 51)(resolutionParams);
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) {
				for (let channel = 0; channel < 4; channel++) near(low[(y * 33 + x) * 4 + channel], high[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], 'resolution independent');
			}
		}
		checks.push('resolution independent arcs');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
