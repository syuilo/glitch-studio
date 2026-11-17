import definition from '../../src/fx/linearBlur/_def_.ts';
import implementation from '../../src/fx/linearBlur/_impl_.ts';
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
		length: scalar(definition.paramDefs.length.defaultValue.value), angle: scalar(definition.paramDefs.angle.defaultValue.value), focusRadius: scalar(0),
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
		// 【長さ0は詳細設定にかかわらず元画像へ戻る】
		// ぼかしを止めても色分散だけが残る誤りや、二重alpha乗算を検出する。
		const render = createEffect(33, 17);
		const coordinateValues = coordinateImage(33, 17);
		const coordinates = textureInput(33, 17, coordinateValues);
		const details = { dispersion: scalar(1), dispersionFalloff: scalar(0.5), bias: scalar(1), highlights: scalar(1), jitter: scalar(1) };
		const bypass = await render({ input: coordinates, length: scalar(0), ...details });
		equal(bypass, new Float32Array(new Float16Array(coordinateValues)), 'zero length', 0);
		checks.push('zero length identity');

		// 【一定色・半透明・HDR・負値を保存する】
		// 分散の正規化不足とalphaの固定を検出し、最小・既定・最大のサンプル数を通す。
		const constantTexture = textureInput(1, 1, constantColor);
		for (const input of [defaults.input, constantTexture]) {
			for (const samples of [4, 32, 256, 4]) {
				const pixels = await render({ input, length: scalar(0.25), angle: scalar(0.125), samples, ...details });
				pixels.forEach((value, index) => near(value, constantColor[index % 4], 'constant color'));
			}
		}
		const transparent = await render({ input: constantShaderInput('color', [8, -4, 2, 0]), ...details });
		transparent.forEach(value => near(value, 0, 'transparent color', 0));
		checks.push('constant colors alpha HDR and sample counts');

		// 【4サンプルの平均から全長と等方性を照合する】
		// 二次関数を使うと、対称なブラーも平均値の増分から検出できる。一次関数だけでは
		// 元画素を返すだけの誤った実装も通ってしまう。既知の2次モーメントで全長を確認する。
		const outerWeight = Math.exp(-0.5 / 0.64);
		const innerWeight = Math.exp(-0.5 / (9 * 0.64));
		const secondMoment = (outerWeight / 4 + innerWeight / 36) / (outerWeight + innerWeight);
		const biasedMean = (outerWeight + innerWeight / 3) / (2 * (outerWeight + innerWeight));
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const longest = Math.max(width, height);
			const quadratic = textureInput(width, height, Array.from({ length: width * height }, (_, index) => {
				const x = (index % width - (width - 1) / 2) / longest;
				const y = ((height - 1) / 2 - Math.floor(index / width)) / longest;
				return [x * x * 16, y * y * 16, x * y * 16, 0.5];
			}).flat());
			const linearRender = createEffect(width, height);
			const centerPixel = (((height - 1) / 2) * width + (width - 1) / 2) * 4;
			for (const angle of [0, 0.125, 0.25]) {
				const pixels = await linearRender({ input: quadratic, length: scalar(0.25), angle: scalar(angle), samples: 4 });
				const cosine = Math.cos(angle * 2 * Math.PI);
				const sine = Math.sin(angle * 2 * Math.PI);
				near(pixels[centerPixel], secondMoment * cosine * cosine, 'known horizontal variance');
				near(pixels[centerPixel + 1], secondMoment * sine * sine, 'known vertical variance');
				near(pixels[centerPixel + 2], -secondMoment * cosine * sine, 'known diagonal covariance');
			}
			const heightPixels = await linearRender({ input: quadratic, length: scalar(0.25), sizeReference: 'height', samples: 4 });
			near(heightPixels[centerPixel], secondMoment * (height / longest) ** 2, 'length size reference');
		}
		checks.push('known full length moments and isotropic diagonals');

		// 【Biasの折り畳みと方向の時計回りを照合する】
		// 片側ブラーの既知の平均移動量を使い、正負のBiasと水平・垂直・斜めを確認する。
		// UVのまま移動すると長さや斜めの角度が縦横比で変わるため、両方の比率で実行する。
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const input = textureInput(width, height, coordinateImage(width, height));
			const linearRender = createEffect(width, height);
			const centerPixel = (((height - 1) / 2) * width + (width - 1) / 2) * 4;
			for (const angle of [0, 0.125, 0.25, 0.5, 0.75]) {
				for (const bias of [-1, 1]) {
					const pixels = await linearRender({ input, length: scalar(0.125), angle: scalar(angle), bias: scalar(bias), samples: 4 });
					const shift = 0.125 * biasedMean * bias * 4;
					near(pixels[centerPixel], 0.5 - Math.cos(angle * 2 * Math.PI) * shift, 'known biased x');
					near(pixels[centerPixel + 1], -0.25 + Math.sin(angle * 2 * Math.PI) * shift, 'known biased y');
				}
			}
		}
		checks.push('clockwise direction and one-sided bias');

		// 【各scalar入力の定数・テクスチャと局所的な長さ・角度を検証する】
		// 全入力の接続も確認し、出力位置の場を途中のサンプル位置で読み直して
		// マスク境界を崩す実装を検出する。方向の場は水平と垂直で比較する。
		const controlValues = { length: 0.125, angle: 0.125, focusRadius: 0.0625, dispersion: 0.5, dispersionFalloff: 0.25, bias: -0.5, highlights: 0.25, jitter: 0.75 };
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
		const lengths = Array.from({ length: 33 * 17 }, (_, index) => index % 33 < 16 ? 0 : 0.25);
		const lengthField = textureInput(33, 17, lengths, true, { filterMode: 'nearest' });
		const blurParams = { input: coordinates, length: scalar(0.25), bias: scalar(1) };
		const blurred = await render(blurParams);
		const localLength = await render({ ...blurParams, length: lengthField });
		localLength.forEach((value, index) => near(value, (lengths[Math.floor(index / 4)] === 0 ? bypass : blurred)[index], 'output-local length'));
		const angles = Array.from({ length: 33 * 17 }, (_, index) => index % 33 < 16 ? 0 : 0.25);
		const angleField = textureInput(33, 17, angles, true, { filterMode: 'nearest' });
		const vertical = await render({ ...blurParams, angle: scalar(0.25) });
		const localAngle = await render({ ...blurParams, angle: angleField });
		localAngle.forEach((value, index) => near(value, (angles[Math.floor(index / 4)] === 0 ? blurred : vertical)[index], 'output-local angle'));
		checks.push('uniform texture and output-local controls');

		// 【画面中央の保護範囲と寸法基準を維持する】
		// 内側は原像、外側は通常ブラーに一致する。Size Referenceは保護半径と
		// ブラーの長さを同時に換算し、方向や分散の距離比には影響させない。
		const focused = await render({ ...blurParams, focusRadius: scalar(0.2) });
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
		equal(await render({ ...blurParams, focusRadius: scalar(0.2), sizeReference: 'height' }),
			await render({ ...blurParams, length: scalar(0.25 * 17 / 33), focusRadius: scalar(0.2 * 17 / 33) }), 'length and focus size reference');
		checks.push('screen-centered focus and size reference');

		// 【半透明の輪郭も直線に沿って伸びる】
		// 分散なしではRGB/alpha比を維持し、分散を加えてもalphaを着色・固定しない。
		const silhouette = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => index % 33 < 16 ? constantColor : [0, 0, 0, 0]).flat());
		const silhouetteParams = { input: silhouette, length: scalar(0.25), bias: scalar(1) };
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
		assert(hasSoftAlpha && hasExtendedAlpha, 'alpha streak extends along the chosen direction');
		const dispersedAlpha = await render({ ...silhouetteParams, dispersion: scalar(1) });
		for (let index = 3; index < softAlpha.length; index += 4) near(dispersedAlpha[index], softAlpha[index], 'dispersion preserves alpha', 0);
		checks.push('transparent streaks and dispersion alpha');

		// 【分散の向きと画面中央からの減衰を検証する】
		// 右へ明るくなる無彩色の画像で、赤と青の重みの並びと符号の反転を照合する。
		const gray = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = 1 + (index % 33 - 16) / 16;
			return [value, value, value, 1];
		}).flat());
		const spectralParams = { input: gray, length: scalar(0.25) };
		const forward = await render({ ...spectralParams, dispersion: scalar(1) });
		const reversed = await render({ ...spectralParams, dispersion: scalar(-1) });
		const peripheral = await render({ ...spectralParams, dispersion: scalar(1), dispersionFalloff: scalar(1) });
		const spectralPixel = (8 * 33 + 24) * 4;
		assert(forward[spectralPixel] > forward[spectralPixel + 2] + 0.02, 'red at negative-offset end');
		assert(reversed[spectralPixel] < reversed[spectralPixel + 2] - 0.02, 'reversed spectrum');
		assert(Math.abs(peripheral[spectralPixel] - peripheral[spectralPixel + 2]) < Math.abs(forward[spectralPixel] - forward[spectralPixel + 2]), 'falloff reduces inner dispersion');
		checks.push('spectral order and falloff');

		// 【Highlightsは明るいサンプルだけを強調する】
		// 負の輝度を二乗して光源扱いする誤りと、入力の負値をclampする誤りを検出する。
		const highlighted = await render({ ...spectralParams, highlights: scalar(1) });
		const ordinaryGray = await render(spectralParams);
		assert(highlighted[spectralPixel] > ordinaryGray[spectralPixel] + 0.01, 'positive highlights emphasized');
		const negativeGray = textureInput(33, 17, Array.from({ length: 33 * 17 }, (_, index) => {
			const value = -1 - index % 33 / 16;
			return [value, value, value, 1];
		}).flat());
		equal(await render({ input: negativeGray, length: scalar(0.25), highlights: scalar(1) }),
			await render({ input: negativeGray, length: scalar(0.25) }), 'negative luminance is not a highlight', 0);
		checks.push('highlight emphasis and negative luminance');

		// 【範囲外の参照も接続のWrapとFitを適用する】
		// 大きな長さで全4サンプルを画像外へ出し、独自の端延長を検出する。
		// Containの余白は接続のFitとTransparentの組合せで処理される必要がある。
		const repeated = textureInput(4, 4, Array.from({ length: 16 }, () => constantColor).flat(), false, { wrapMode: 'repeat', filterMode: 'nearest' });
		if (repeated.kind !== 'texture') throw new Error('Expected a texture input');
		const emptyOutside = textureShaderInput(repeated.texture, { wrapMode: 'transparent', filterMode: 'nearest', fitMode: 'stretch' });
		const outsideParams = { length: scalar(8), samples: 4 };
		const repeatOutside = await render({ input: repeated, ...outsideParams });
		const transparentOutside = await render({ input: emptyOutside, ...outsideParams });
		repeatOutside.forEach((value, index) => near(value, constantColor[index % 4], 'repeat outside'));
		transparentOutside.forEach(value => near(value, 0, 'transparent outside', 0));
		const contained = textureShaderInput(repeated.texture, { wrapMode: 'transparent', filterMode: 'nearest', fitMode: 'contain' });
		const containPixels = await createEffect(8, 4)({ input: contained, length: scalar(0) });
		containPixels.forEach((value, index) => near(value, Math.floor(index / 4) % 8 >= 2 && Math.floor(index / 4) % 8 < 6 ? constantColor[index % 4] : 0, 'contain sampling', 0));
		checks.push('input wrap fit and filtering');

		// 【方向の周回と値域制限、サンプル表の更新を検証する】
		// 方向は1turn周期だが、長さは1で制限しない。表を別のサンプル数へ
		// 更新してから戻す比較で、古い重みのまま描く誤りも検出する。
		const bounded = { input: coordinates, length: scalar(0.25), angle: scalar(0.125), focusRadius: scalar(0), dispersion: scalar(-1), dispersionFalloff: scalar(1), bias: scalar(1), highlights: scalar(1), jitter: scalar(1), samples: 4 };
		const unbounded = { input: coordinates, length: scalar(0.25), angle: scalar(1.125), focusRadius: scalar(-1), dispersion: scalar(-9), dispersionFalloff: scalar(9), bias: scalar(9), highlights: scalar(9), jitter: scalar(9), samples: -1 };
		const boundedPixels = await render(bounded);
		equal(await render(unbounded), boundedPixels, 'parameter bounds', 0);
		equal(await render({ ...bounded, angle: scalar(-0.875) }), boundedPixels, 'negative direction wraps', 0);
		await render({ ...bounded, samples: 64 });
		equal(await render(bounded), boundedPixels, 'sample table restored', 0);
		equal(await render({ input: coordinates, samples: 4.6 }), await render({ input: coordinates, samples: 5 }), 'sample rounding', 0);
		equal(await render({ input: coordinates, samples: 1000 }), await render({ input: coordinates, samples: 256 }), 'sample upper bound', 0);
		equal(await render({ input: coordinates, length: scalar(-1) }), bypass, 'negative length', 0);
		const long = await render({ input: coordinates, length: scalar(2), bias: scalar(1), samples: 4 });
		const shorter = await render({ input: coordinates, length: scalar(1), bias: scalar(1), samples: 4 });
		assert(long.some((value, index) => Math.abs(value - shorter[index]) > 0.05), 'length is not capped at one');
		checks.push('periodic angles bounds and table restoration');

		// 【JitterはSeedで変わり、時刻とタイルには依存しない】
		// 位相差が見える高周波画像で最小サンプル数を使い、分割描画も画素単位で比較する。
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

		// 【解像度を変えても同じ共通位置の軌跡が一致する】
		// 固定した入力を3倍解像度へ描き、長さ・方向・Focusの寸法換算に画素数が混入しないか調べる。
		const resolutionParams = { input: coordinates, ...controls, jitter: scalar(0) };
		const low = await render(resolutionParams);
		const high = await createEffect(99, 51)(resolutionParams);
		for (let y = 0; y < 17; y++) {
			for (let x = 0; x < 33; x++) {
				for (let channel = 0; channel < 4; channel++) near(low[(y * 33 + x) * 4 + channel], high[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], 'resolution independent');
			}
		}
		checks.push('resolution independent streaks');

		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

