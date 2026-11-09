import definition from '../../src/fx/paletteMatch/_def_.ts';
import implementation from '../../src/fx/paletteMatch/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const gray = (value: number, alpha = 1): Color => [value * alpha, value * alpha, value * alpha, alpha];

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }),
			targets: [{ format: 'rgba32float' }],
		},
	});
	const defaults: Parameters = {
		input: constantShaderInput('color', [0, 0, 0, 0]), reference: constantShaderInput('color', [0, 0, 0, 0]),
		inputAnalysisMask: constantShaderInput('scalar', 1), referenceAnalysisMask: constantShaderInput('scalar', 1),
		lightnessMatch: 0, chromaMatch: 1, maximumGain: 4, analysisSamples: 4096,
	};
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	function texture(width: number, height: number, pixels: Color[], sampling: Partial<ShaderInputSampling> = {}) {
		if (pixels.length !== width * height) throw new Error('Invalid test image size');
		const image = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: image }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, height]);
		disposables.push(() => image.destroy());
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...sampling });
	}
	function createEffect(width: number, height: number, enable32bitDataTextures = false) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba16float' as const, enable32bitDataTextures };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const commandEncoder = device.createCommandEncoder();
			effect.render({
				params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 0,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
				createComputePassEncoder: encoder => encoder.beginComputePass(),
				createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(3); pass.end();
			commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
	}
	function compare(actual: Float32Array, expected: Color[], label: string, tolerance = 0.004) {
		const components = expected.flat();
		if (actual.length !== components.length) throw new Error(`${label}: dimensions`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || Math.abs(value - components[index]) > tolerance) throw new Error(`${label}: pixel ${Math.floor(index / 4)} channel ${index % 4}: ${value} != ${components[index]}`);
		});
		checks.push(label);
	}
	type Lab = [number, number, number];
	const decode = (value: number) => Math.abs(value) <= 0.04045 ? value / 12.92 : Math.sign(value) * ((Math.abs(value) + 0.055) / 1.055) ** 2.4;
	const encode = (value: number) => Math.abs(value) <= 0.0031308 ? value * 12.92 : Math.sign(value) * (1.055 * Math.abs(value) ** (1 / 2.4) - 0.055);
	function fromLab(lab: Lab, alpha = 1): Color {
		const [lightness, opponentA, opponentB] = lab;
		const l = (lightness + 0.3963377774 * opponentA + 0.2158037573 * opponentB) ** 3;
		const m = (lightness - 0.1055613458 * opponentA - 0.0638541728 * opponentB) ** 3;
		const s = (lightness - 0.0894841775 * opponentA - 1.291485548 * opponentB) ** 3;
		return [encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * alpha,
			encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * alpha,
			encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * alpha, alpha];
	}
	function toLab(color: Color): Lab {
		const [r, g, b] = color.slice(0, 3).map(value => decode(value / color[3]));
		const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
		const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
		const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
		return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
			1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
			0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
	}
	const pixelColors = (pixels: ArrayLike<number>): Color[] => Array.from({ length: pixels.length / 4 }, (_, index) => [
		pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2], pixels[index * 4 + 3],
	]);
	const packed = (colors: Color[]) => pixelColors(new Float16Array(colors.flat()));
	const mask = (values: number[]) => texture(values.length, 1, values.map(value => [value, 0, 0, 1]));
	function moments(colors: Color[]) {
		const labs = colors.map(toLab);
		const weight = colors.reduce((sum, color) => sum + color[3], 0);
		const mean = [0, 1, 2].map(axis => labs.reduce((sum, lab, index) => sum + lab[axis] * colors[index][3], 0) / weight) as Lab;
		const covariance = [0, 1, 2].map(row => [0, 1, 2].map(column => labs.reduce((sum, lab, index) => sum + (lab[row] - mean[row]) * (lab[column] - mean[column]) * colors[index][3], 0) / weight));
		return { mean, covariance };
	}
	function near(actual: number, expected: number, tolerance: number, label: string) {
		if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) throw new Error(`${label}: ${actual} != ${expected}`);
	}
	function compareLabs(pixels: Float32Array, expected: Lab[], label: string) {
		pixelColors(pixels).map(toLab).forEach((lab, index) => lab.forEach((value, axis) => near(value, expected[index][axis], 0.0015, `${label}: pixel ${index} axis ${axis}`)));
		checks.push(label);
	}
	try {
		const sourceLabs = Array.from({ length: 8 }, (_, index) => [
			0.6 + ((index & 1) === 0 ? -0.04 : 0.04),
			0.01 + ((index & 2) === 0 ? -0.02 : 0.02),
			0.01 + ((index & 4) === 0 ? -0.01 : 0.01),
		] as Lab);
		// 対称な正定値行列で作った参照なら、Gaussianの対称転送はこの既知の行列になる。
		// 実装側の固有値分解や平方根をテストで再実装せず、非対角成分の効果まで検証する。
		const referenceLabs = sourceLabs.map(([lightness, opponentA, opponentB]) => {
			const [x, y, z] = [lightness - 0.6, opponentA - 0.01, opponentB - 0.01];
			return [0.65 + 1.2 * x + 0.3 * y + 0.1 * z, -0.03 + 0.3 * x + 1.1 * y - 0.2 * z, 0.04 + 0.1 * x - 0.2 * y + 0.9 * z] as Lab;
		});
		const sourceColors = sourceLabs.map(lab => fromLab(lab));
		const referenceColors = referenceLabs.map(lab => fromLab(lab));
		const input = texture(4, 2, sourceColors);
		const reference = texture(4, 2, referenceColors);
		const render = createEffect(4, 2);
		const base: Partial<Parameters> = { input, reference, lightnessMatch: 1, analysisSamples: 8 };

		// 【平均だけでなく色成分間の共分散を既知の対称行列へ近づける】
		// 平均移動やRGB各成分の倍率だけでは、この非対角の対応と出力共分散にならない。
		const matched = await render(base);
		compare(matched, referenceColors, 'matches the known symmetric Oklab color transform');
		const actualMoments = moments(pixelColors(matched));
		const expectedMoments = moments(packed(referenceColors));
		actualMoments.mean.forEach((value, axis) => near(value, expectedMoments.mean[axis], 0.001, 'matched Oklab mean'));
		actualMoments.covariance.forEach((row, axis) => row.forEach((value, column) => near(value, expectedMoments.covariance[axis][column], 0.00002, 'matched Oklab covariance')));
		checks.push('matches all covariance entries including cross-channel correlations');

		// 【主入力側のalphaも共分散へ重み付けし、複数段の部分統計を正しく集約する】
		// 不透明な参照へ半透明の入力を合わせ、出力のalpha重み付き統計が参照と一致することを確認する。
		// 最大解析数では1024個の部分統計を使うため、最終workgroupの各laneにも複数項目が割り当たる。
		const weightedSource = sourceColors.map((color, index) => {
			const alpha = index % 2 === 0 ? 0.25 : 0.75;
			return [color[0] * alpha, color[1] * alpha, color[2] * alpha, alpha] as Color;
		});
		for (const analysisSamples of [8, 65536]) {
			const weightedPixels = await render({ ...base, input: texture(4, 2, weightedSource), analysisSamples });
			const weightedMoments = moments(pixelColors(weightedPixels));
			weightedMoments.mean.forEach((value, axis) => near(value, expectedMoments.mean[axis], 0.001, 'alpha-weighted input mean'));
			weightedMoments.covariance.forEach((row, axis) => row.forEach((value, column) => near(value, expectedMoments.covariance[axis][column], 0.00002, 'alpha-weighted input covariance')));
			pixelColors(weightedPixels).forEach((color, index) => near(color[3], weightedSource[index][3], 0, 'unchanged alpha'));
			checks.push(`${analysisSamples} samples match alpha-weighted input moments`);
		}

		// 【明度・色味を独立に調整し、0の成分は元のOklab値を保つ】
		// RGB空間の単純な合成や、明度保持が色味の転送も止めてしまう実装を防ぐ。
		compareLabs(await render({ ...base, lightnessMatch: 0 }), sourceLabs.map((lab, index) => [lab[0], referenceLabs[index][1], referenceLabs[index][2]]), 'preserves input lightness while matching chroma');
		compareLabs(await render({ ...base, chromaMatch: 0 }), sourceLabs.map((lab, index) => [referenceLabs[index][0], lab[1], lab[2]]), 'preserves input chroma while matching lightness');
		compareLabs(await render({ ...base, lightnessMatch: 0.25, chromaMatch: 0.75 }), sourceLabs.map((lab, index) => lab.map((value, axis) => value + (referenceLabs[index][axis] - value) * (axis === 0 ? 0.25 : 0.75)) as Lab), 'independently interpolates lightness and chroma');

		// 【無効な調整と自分自身への参照は色空間変換を往復せず元画像を返す】
		// 単色・特異な共分散・前回の変換が残る経路でも、変化のない画像を劣化させない。
		compare(await render({ ...base, lightnessMatch: 0, chromaMatch: 0 }), packed(sourceColors), 'zero component controls return exact input pixels', 0);
		compare(await render({ ...base, reference: input }), packed(sourceColors), 'self reference returns exact input pixels', 0);
		compare(await render({ ...base, reference: texture(4, 2, [...sourceColors].reverse()) }), sourceColors, 'matching color statistics preserves spatial geometry');

		// 【単色の主入力は平均色の移動に留め、参照の模様を生成しない】
		// 分散0の逆平方根でNaNを作ったり、画素位置に依存して色を割り当てる実装を防ぐ。
		const expectedMean = moments(packed(referenceColors)).mean;
		compare(await render({ ...base, input: constantShaderInput('color', [0.5, 0.5, 0.5, 1]) }), Array.from({ length: 8 }, () => fromLab(expectedMean)), 'flat input maps to the reference mean without invented texture');

		// 【共分散の主軸における増幅率へ上限を適用する】
		// 対角成分をclampするだけの処理や、非常に狭い分布を無制限に拡大する処理を検出する。
		const gainSourceLabs = Array.from({ length: 8 }, (_, index) => [
			0.5 + ((index & 1) === 0 ? -0.01 : 0.01),
			(index & 2) === 0 ? -0.02 : 0.02,
			(index & 4) === 0 ? -0.03 : 0.03,
		] as Lab);
		const gainSource = gainSourceLabs.map(lab => fromLab(lab));
		const gainReference = gainSourceLabs.map(lab => fromLab([0.6 + (lab[0] - 0.5) * 8, lab[1], lab[2]]));
		const gainPixels = await render({ ...base, input: texture(4, 2, gainSource), reference: texture(4, 2, gainReference), maximumGain: 2 });
		const gainMoments = moments(pixelColors(gainPixels));
		const inputMoments = moments(packed(gainSource));
		near(Math.sqrt(gainMoments.covariance[0][0] / inputMoments.covariance[0][0]), 2, 0.05, 'maximum principal-axis gain');
		near(gainMoments.mean[0], 0.6, 0.001, 'gain limit keeps the reference mean');
		checks.push('limits principal-axis gain without changing the target mean');

		// 【RGB成分に対して斜めの主軸でも増幅率を制限する】
		// 固有値8・1・1の行列を2・1・1へ制限する。対角成分だけのclampでは斜めの増幅が残る。
		const rotatedSourceLabs = Array.from({ length: 8 }, (_, index) => [
			0.6 + ((index & 1) === 0 ? -0.02 : 0.02), (index & 2) === 0 ? -0.02 : 0.02, (index & 4) === 0 ? -0.02 : 0.02,
		] as Lab);
		const rotatedReference = rotatedSourceLabs.map(([lightness, opponentA, opponentB]) => fromLab([
			0.65 + 4.5 * (lightness - 0.6) + 3.5 * opponentA, 3.5 * (lightness - 0.6) + 4.5 * opponentA, opponentB,
		]));
		const rotatedExpected = rotatedSourceLabs.map(([lightness, opponentA, opponentB]) => fromLab([
			0.65 + 1.5 * (lightness - 0.6) + 0.5 * opponentA, 0.5 * (lightness - 0.6) + 1.5 * opponentA, opponentB,
		]));
		compare(await render({ ...base, input: texture(4, 2, rotatedSourceLabs.map(lab => fromLab(lab))), reference: texture(4, 2, rotatedReference), maximumGain: 2 }),
			rotatedExpected, 'limits covariance gain along rotated principal axes');

		const pairRender = createEffect(2, 1);
		const narrowColors = [gray(0.25), gray(0.250244140625)];
		const narrowPixels = await pairRender({ input: texture(2, 1, narrowColors), reference: texture(2, 1, [gray(0), gray(1)]), lightnessMatch: 1, analysisSamples: 2 });
		const narrowLabs = pixelColors(narrowPixels).map(toLab);
		const inputSpan = toLab(narrowColors[1])[0] - toLab(narrowColors[0])[0];
		if (Math.abs(narrowLabs[1][0] - narrowLabs[0][0]) > inputSpan * 4.05 + 0.0005) throw new Error('Nearly flat input was amplified beyond Maximum Gain');
		checks.push('nearly flat inputs remain finite with bounded color variation');

		// 【透明画素を除外し、可視色をalphaと解析マスクの積で重み付けする】
		// 半透明の青を不透明な黒と取り違えたり、隠れたRGBを参照の配色へ含める実装を検出する。
		const weightedReference: Color[] = [[0.25, 0, 0, 0.25], [0, 0, 0.75, 0.75], [4, 2, 1, 0]];
		const weightedRender = createEffect(3, 1);
		const weightedBase: Partial<Parameters> = {
			input: constantShaderInput('color', [0.5, 0.5, 0.5, 1]), reference: texture(3, 1, weightedReference), lightnessMatch: 1, analysisSamples: 3,
		};
		const redLab = toLab([1, 0, 0, 1]);
		const blueLab = toLab([0, 0, 1, 1]);
		const weightedMean = redLab.map((value, axis) => value * 0.25 + blueLab[axis] * 0.75) as Lab;
		compare(await weightedRender(weightedBase), Array.from({ length: 3 }, () => fromLab(weightedMean)), 'weights reference colors by alpha and excludes invisible RGB');
		compare(await weightedRender({ ...weightedBase, referenceAnalysisMask: mask([1, 0, 0]) }), Array.from({ length: 3 }, () => [1, 0, 0, 1] as Color), 'reference analysis mask selects red');
		compare(await weightedRender({ ...weightedBase, referenceAnalysisMask: mask([0, 1, 0]) }), Array.from({ length: 3 }, () => [0, 0, 1, 1] as Color), 'changing the reference mask selects blue');
		const equalMean = redLab.map((value, axis) => (value + blueLab[axis]) * 0.5) as Lab;
		compare(await weightedRender({ ...weightedBase, referenceAnalysisMask: mask([0.75, 0.25, 0]) }), Array.from({ length: 3 }, () => fromLab(equalMean)), 'fractional masks multiply the alpha weights');

		// 【主入力の解析マスクは統計だけを選び、変換は画像全体へ適用する】
		// マスクを出力の適用量として誤用すると、選択外の明るい画素が変化しない。
		const maskSource = [gray(0.1), gray(0.9)];
		const delta = toLab(gray(0.5)).map((value, axis) => value - toLab(packed(maskSource)[0])[axis]) as Lab;
		const maskExpected = packed(maskSource).map(color => fromLab(toLab(color).map((value, axis) => value + delta[axis]) as Lab));
		compare(await pairRender({
			input: texture(2, 1, maskSource), reference: constantShaderInput('color', [0.5, 0.5, 0.5, 1]), inputAnalysisMask: mask([1, 0]), lightnessMatch: 1, analysisSamples: 2,
		}), maskExpected, 'input analysis mask chooses statistics without masking the output');

		// 【元のalphaと透明境界を保持し、空の解析対象では古い変換を使わない】
		// 画像に色を移すことと被覆率を変えることを分離し、入力変更後の残留変換を検出する。
		const alphaColors: Color[] = [[0.25, 0, 0, 0.25], [0, 0.75, 0, 0.75], [0, 0, 0, 0]];
		const alphaInput = texture(3, 1, alphaColors);
		const alphaBase: Partial<Parameters> = { input: alphaInput, reference: constantShaderInput('color', [0.125, 0.5, 0.75, 1]), lightnessMatch: 1, analysisSamples: 3 };
		const alphaExpected = alphaColors.map(color => [0.125 * color[3], 0.5 * color[3], 0.75 * color[3], color[3]] as Color);
		compare(await weightedRender(alphaBase), alphaExpected, 'preserves source alpha with a flat reference palette');
		compare(await weightedRender({ ...alphaBase, reference: constantShaderInput('color', [1, 0, 1, 0]) }), packed(alphaColors), 'transparent reference disables the previous transform', 0);
		compare(await weightedRender({ ...alphaBase, referenceAnalysisMask: constantShaderInput('scalar', 0) }), packed(alphaColors), 'empty reference mask passes the source through', 0);
		compare(await weightedRender({ ...alphaBase, inputAnalysisMask: constantShaderInput('scalar', 0) }), packed(alphaColors), 'empty input mask passes the source through', 0);
		compare(await weightedRender(alphaBase), alphaExpected, 'valid statistics replace an empty analysis result');

		// 【非平方数・workgroup境界・集約容量の拡張縮小でも解析点数を正確に扱う】
		// 定数同士の既知の結果を使い、端のlaneや前回の余った部分統計が混入しないことを確認する。
		for (const analysisSamples of [1, 3, 7, 65, 257, 4096, 65536, 2]) {
			compare(await pairRender({
				input: constantShaderInput('color', [0.3, 0.3, 0.3, 0.4]), reference: constantShaderInput('color', [0.1, 0.6, 0.8, 0.6]), lightnessMatch: 1, analysisSamples,
			}), Array.from({ length: 2 }, () => [0.04, 0.24, 0.32, 0.4] as Color), `${analysisSamples} analysis samples retain the constant color mapping`);
		}

		// 【入力解像度と解析点を分離し、異なる縦横比の参照には接続のFitを適用する】
		// 参照のcontain余白を黒として平均したり、出力倍率で解析格子を変える実装を防ぐ。
		const scaledRender = createEffect(8, 4);
		const scaledExpected = Array.from({ length: 4 }, (_, y) => Array.from({ length: 8 }, (_, x) => referenceColors[Math.floor(y / 2) * 4 + Math.floor(x / 2)])).flat();
		compare(await scaledRender(base), scaledExpected, 'analysis and palette mapping are resolution independent');
		for (const fitMode of ['stretch', 'contain'] as const) {
			const fittedReference = texture(1, 2, [[1, 0, 0, 1], [0, 0, 1, 1]], { fitMode, wrapMode: 'transparent' });
			compare(await render({ input: constantShaderInput('color', [0.5, 0.5, 0.5, 1]), reference: fittedReference, lightnessMatch: 1, analysisSamples: 64 }),
				Array.from({ length: 8 }, () => fromLab(equalMean)), `reference ${fitMode} fit and transparent margins`);
		}

		// 【データ精度にかかわらず、16bit floatの画像出力でHDR・負値を保持する】
		// 符号なしの立方根やsRGB変換では負値がNaNになり、範囲制限ではHDRの色調を失う。
		for (const enable32bitDataTextures of supports32bit ? [false, true] : [false]) {
			const rangeRender = createEffect(2, 1, enable32bitDataTextures);
			for (const target of [[2, -0.125, 0.5, 1], [0.1, -0.5, 0.05, 1]] as Color[]) {
				compare(await rangeRender({ input: texture(2, 1, [gray(0.25), gray(0.75)]), reference: constantShaderInput('color', target), lightnessMatch: 1, analysisSamples: 2 }),
					[target, target], `32bit data=${enable32bitDataTextures} preserves extended RGB values ${target.slice(0, 3).join(',')}`);
			}
		}

		// 【不正な制御値は定義済みの範囲へ揃え、履歴や時刻には依存しない】
		// パラメータを戻した際に別の変換や解析精度が残ることを防ぐ。
		compareLabs(await render({ ...base, lightnessMatch: NaN, chromaMatch: NaN, maximumGain: NaN, analysisSamples: NaN }),
			sourceLabs.map((lab, index) => [lab[0], referenceLabs[index][1], referenceLabs[index][2]]), 'nonfinite controls use documented defaults');
		compare(await render(base, 100), referenceColors, 'palette matching is deterministic after input and control changes');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
