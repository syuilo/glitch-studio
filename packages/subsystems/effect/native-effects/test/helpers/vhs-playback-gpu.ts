import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/vhsPlayback/_def_.ts';
import implementationNative from '../../src/fx/vhsPlayback/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput, type ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { VHS_TAPE } from '../../src/fx/vhsPlayback/signal.ts';
import { checkHeadSpacingOnGpu } from './vhs-head-spacing-gpu.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, 'canNode' in parameter && parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.001) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const color = (value: number[]) => constantShaderInput('color', value);
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const vector = (value: number[]) => constantShaderInput('vector', value);
	const checkColor = (pixels: Float32Array, expected: ArrayLike<number>, label: string, offset = 0, tolerance = 0.001) => Array.from(expected).forEach((value, channel) => near(pixels[offset + channel], value, label, tolerance));
	const equal = (a: Float32Array, b: Float32Array, label: string) => assert(a.length === b.length && a.every((value, index) => value === b[index]), label);
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
			targets: [{ format: 'rgba32float' }],
		},
	});
	function field(width: number, height: number, componentCount: 1 | 2 | 4, value: (x: number, y: number) => number[], sampling: Partial<ShaderInputSampling> = {}) {
		const texture = device.createTexture({ size: [width, height], format: componentCount === 1 ? 'r16float' : componentCount === 2 ? 'rg16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const pixels = new Float16Array(width * height * componentCount);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(value(x, y), (y * width + x) * componentCount);
		device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * componentCount * 2 }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp', ...sampling });
	}
	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.createTexture('output', { wgpu, resolution });
		assert(output.format === INTERMEDIATE_TEXTURE_FORMAT, 'fixed rgba16float image output');
		const effect = implementation.place(wgpu, resolution);
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			await effect.draw({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite image output');
			return pixels;
		};
	}
	try {
		const sample = createEffect(1, 1);
		const clean: Partial<Parameters> = {
			trackingOffset: 0, trackAlignmentError: 0, timeBaseError: 0, scanTimingDrift: 0,
			headContact: 1, headSeparation: scalar(0), headSwitching: false, dropoutRate: 0,
			rfNoiseFloor: -100, dropoutCompensation: false, timeBaseCorrection: 1,
		};
		// 【正常なFM記録・復調では、振幅や搬送波の位相を画素値と取り違えない】
		// 異なる明るさの無彩色を往復し、FM変換の定数・符号・帯域抽出を実際に検証する。
		for (const gray of [0.15, 0.45, 0.8]) {
			checkColor(await sample({ ...clean, input: color([gray, gray, gray, 1]) }), [gray, gray, gray, 1], 'clean grayscale', 0, 0.025);
		}
		checks.push('FM grayscale round trip');

		// 【カラーアンダー信号を復調すると、元の色相と彩度が概ね戻る】
		// 輝度FMだけを処理した実装や、I/Qの符号・バースト補正の誤りを検出する。
		const opaque = await sample({ ...clean, input: color([0.25, 0.5, 0.75, 1]) });
		checkColor(opaque, [0.25, 0.5, 0.75, 1], 'color-under round trip', 0, 0.065);
		checks.push('color-under round trip');

		// 【被覆率を保持するモードでは、信号処理によって透明部分を不透明にしない】
		// ノイズの直接加算や、premultiplied色をそのまま変調する実装では満たせない。
		const translucent = await sample({ ...clean, input: color([0.25, 0.5, 0.75, 0.5]) });
		checkColor(translucent, Array.from(opaque, (value, channel) => channel === 3 ? 0.5 : value * 0.5), 'coverage-independent color', 0, 0.003);
		checkColor(await sample({ input: color([1, 0.5, 0.25, 0]) }), [0, 0, 0, 0], 'transparent signal', 0, 0);
		checks.push('premultiplied coverage');

		// 【不透明モードでは背景色へ合成してから録画する】
		// 背景が復調後に貼られ、信号処理を通らない問題を防ぐ。
		checkColor(await sample({ ...clean, input: color([0.8, 0.2, 0.2, 0]), alphaMode: 'opaque', backgroundColor: [0.4, 0.4, 0.4, 1] }), [0.4, 0.4, 0.4, 1], 'background before recording', 0, 0.025);
		checks.push('background before recording');

		const render = createEffect(64, 48);
		const image = field(64, 48, 4, (x, y) => {
			const value = 0.2 + 0.6 * ((Math.floor(x / 8) + Math.floor(y / 8)) % 2);
			return [value, value, value, 1];
		});
		const settings = { input: image, seed: 37, time: 1.25 };
		const first = await render(settings);
		// 【同じテープ位置は、シーク・別入力の描画・異なる時計から戻っても同じ結果になる】
		// 前フレームやctx.timeDeltaに基づく乱数・補償履歴への依存を検出する。
		await render({ ...settings, time: 9, seed: 3 }, 100);
		equal(first, await render(settings, 500), 'history-independent tape replay');
		const changedTime = await render({ ...settings, time: 1.5 });
		assert(changedTime.some((value, index) => value !== first[index]), 'tape advances with Time');
		const changedSeed = await render({ ...settings, seed: 38 });
		assert(changedSeed.some((value, index) => value !== first[index]), 'independent tape seed');
		checks.push('deterministic tape time and seed');

		// 【信号振幅の軽い低下では画像を暗くせず、FM信号が読める範囲で明るさを保つ】
		// 接触率をRGBやalphaへ単純に乗算する代用を防ぐ。
		const contact = await sample({ ...clean, input: color([0.45, 0.45, 0.45, 1]), headContact: 0.35 });
		checkColor(contact, [0.45, 0.45, 0.45, 1], 'FM amplitude rejection', 0, 0.03);
		checks.push('FM amplitude rejection');

		// 【同じ仮想フィールドを別の出力解像度で描画しても、損傷の相対位置を変えない】
		// 出力ピクセル・フレーム数を乱数や内部サンプル数へ混ぜる実装を検出する。
		const larger = createEffect(128, 96);
		const large = await larger(settings);
		let difference = 0;
		for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
			for (let channel = 0; channel < 3; channel++) {
				const average = [0, 1].flatMap(dy => [0, 1].map(dx => large[((y * 2 + dy) * 128 + x * 2 + dx) * 4 + channel])).reduce((sum, value) => sum + value, 0) / 4;
				difference += Math.abs(average - first[(y * 64 + x) * 4 + channel]);
			}
		}
		assert(difference / (64 * 48 * 3) < 0.035, 'resolution-independent signal model');
		checks.push('resolution-independent signal');

		// 【時間軸補正は、復調した同期に基づいて輪郭の水平位置を復元する】
		// 元の画像へ逆変形をかけるだけの補正や、同期パルスの誤検出を検出する。
		const edge = field(64, 48, 4, x => x < 32 ? [0.2, 0.2, 0.2, 1] : [0.8, 0.8, 0.8, 1]);
		const stable = await render({ ...clean, input: edge });
		const shifted = await render({ ...clean, input: edge, timeBaseError: 3, scanTimingDrift: 6, timeBaseCorrection: 0 });
		const corrected = await render({ ...clean, input: edge, timeBaseError: 3, scanTimingDrift: 6, timeBaseCorrection: 1 });
		const edgeError = (values: Float32Array) => Array.from({ length: 48 }, (_, y) => {
			let total = 0;
			for (let x = 22; x < 42; x++) total += Math.abs(values[(y * 64 + x) * 4] - stable[(y * 64 + x) * 4]);
			return total;
		}).reduce((sum, value) => sum + value, 0);
		assert(edgeError(corrected) < edgeError(shifted), `sync-based time-base correction: ${edgeError(corrected)} >= ${edgeError(shifted)}`);
		checks.push('sync-based time-base correction');

		// 【欠損補償を有効にすると、一定画像の白黒スパイクが減少する】
		// 欠損の位置を変えず、同じRF信号の1H補償だけを切り替えて比較する。
		const damaged = { ...clean, input: color([0.45, 0.45, 0.45, 1]), dropoutRate: 4000, dropoutDuration: 18, dropoutDepth: 1, rfNoiseFloor: -36, seed: 42 };
		const uncompensated = await render({ ...damaged, dropoutCompensation: false });
		const compensated = await render({ ...damaged, dropoutCompensation: true });
		const grayscaleError = (values: Float32Array) => values.reduce((sum, value, index) => sum + (index % 4 === 0 ? Math.abs(value - 0.45) : 0), 0);
		assert(grayscaleError(compensated) < grayscaleError(uncompensated), '1H dropout compensation improves constant image');
		checks.push('1H dropout compensation');

		// 【色信号は輝度より狭い帯域で記録され、細かな色縞が優先して失われる】
		// RGBを同じカーネルでぼかす代用では満たせない、VHSの帯域差を確認する。
		const fineGray = field(64, 48, 4, x => {
			const value = 0.5 + (x % 2 === 0 ? 0.12 : -0.12);
			return [value, value, value, 1];
		});
		const fineChroma = field(64, 48, 4, x => {
			const value = x % 2 === 0 ? 0.12 : -0.12;
			return [0.5 + 0.9563 * value, 0.5 - 0.2721 * value, 0.5 - 1.107 * value, 1];
		});
		const grayStripes = await render({ ...clean, input: fineGray });
		const colorStripes = await render({ ...clean, input: fineChroma });
		let grayContrast = 0;
		let colorContrast = 0;
		for (let x = 8; x < 56; x++) {
			const index = (24 * 64 + x) * 4;
			grayContrast += Math.abs(grayStripes[index] - 0.5);
			colorContrast += Math.abs(colorStripes[index] - colorStripes[index + 2]) / 2.0633;
		}
		assert(colorContrast < grayContrast * 0.5, 'narrower chroma recording bandwidth');
		checks.push('separate luminance and chroma bandwidth');

		// 【ヘッド切替による乱れは切替点付近に現れ、上部の画像へ波及しない】
		// 独立した乱数の横帯を重ねる実装や、画面全体の時間ずれとの混同を防ぐ。
		const noSwitch = await render({ ...clean, input: image, timeBaseCorrection: 0, headTimingDifference: 5 });
		const switched = await render({ ...clean, input: image, timeBaseCorrection: 0, headTimingDifference: 5, headSwitching: true });
		assert(noSwitch.slice(0, 40 * 64 * 4).every((value, index) => value === switched[index]), 'head switching leaves earlier lines unchanged');
		assert(noSwitch.slice(46 * 64 * 4).some((value, index) => value !== switched[46 * 64 * 4 + index]), 'head switching affects lower lines');
		checks.push('head switching location');

		// 【傷入力の定数とテクスチャは同じ信号損失を表し、未接続の0で既存の画像を変えない】
		// 主画像の定数／テクスチャとの全4構成を通し、readTapeの入力bindingを確認する。
		const zeroDamage = field(4, 4, 1, () => [0]);
		const halfDamage = field(4, 4, 1, () => [0.5]);
		const grayInput = color([0.45, 0.45, 0.45, 1]);
		const cleanGray = await sample({ ...clean, input: grayInput });
		equal(cleanGray, await sample({ ...clean, input: grayInput, tapeDamage: zeroDamage }), 'zero damage texture preserves uniform input');
		equal(await sample({ ...clean, input: grayInput, tapeDamage: scalar(0.5) }), await sample({ ...clean, input: grayInput, tapeDamage: halfDamage }), 'uniform and texture damage agree for uniform image');
		equal(await render({ ...clean, input: image, tapeDamage: scalar(0.5) }), await render({ ...clean, input: image, tapeDamage: halfDamage }), 'uniform and texture damage agree for textured image');
		checkColor(await sample({ ...clean, input: grayInput, tapeDamage: scalar(0.5) }), cleanGray, 'damage attenuates RF instead of image brightness', 0, 0.015);
		checks.push('scalar and texture tape damage');

		// 【完全な傷では映像信号だけが消え、電気的雑音は残る】
		// RGBへの黒マスクや、画像と雑音を一緒に減衰させる処理を検出する。
		const erasedSettings = { ...clean, tapeDamage: scalar(1), rfNoiseFloor: -36 };
		const erased = await render({ ...erasedSettings, input: color([0.2, 0.2, 0.2, 1]) });
		equal(erased, await render({ ...erasedSettings, input: color([0.8, 0.8, 0.8, 1]) }), 'erased recording is independent of recorded image');
		const erasedRed = Array.from({ length: 64 * 48 }, (_, index) => erased[index * 4]);
		assert(Math.max(...erasedRed) - Math.min(...erasedRed) > 0.05, 'electrical noise survives tape damage');
		checks.push('RF erasure before electrical noise');

		// 【テープ上の長手方向の境界を斜めに横切ると、走査の途中から信号が失われる】
		// 画面の右半分へ傷画像を重ねる処理では、上部全体を保って下部だけを壊せない。
		const stepDamage = field(64, 16, 1, x => [x >= 32 ? 1 : 0], { wrapMode: 'transparent' });
		const surfaceSettings = { ...clean, input: grayInput, rfNoiseFloor: -36, tapeDamage: stepDamage };
		const surfaceReference = await render({ ...surfaceSettings, tapeDamage: scalar(0) });
		const surfaceDamaged = await render(surfaceSettings);
		equal(surfaceReference.slice(0, 12 * 64 * 4), surfaceDamaged.slice(0, 12 * 64 * 4), 'undamaged earlier scan lines');
		assert(surfaceDamaged.slice(36 * 64 * 4).some((value, index) => Math.abs(value - surfaceReference[36 * 64 * 4 + index]) > 0.1), 'later scan lines cross the material defect');
		checks.push('helical tape surface intersection');

		// 【有限な傷マップを通り過ぎると正常なテープへ戻り、Offsetでその物理位置を移動できる】
		// Timeを無視する画面マスクや、transparentを強制repeatする実装を防ぐ。
		const passedDamage = await render({ ...surfaceSettings, time: 10 });
		equal(passedDamage, await render({ ...surfaceSettings, time: 10, tapeDamage: scalar(0) }), 'passed finite damage map');
		const movedDamage = await render({ ...surfaceSettings, time: 10, tapeSurfaceOffset: 10 });
		assert(movedDamage.some((value, index) => Math.abs(value - passedDamage[index]) > 0.1), 'damage offset moves material defect');
		await render({ ...surfaceSettings, time: -10 }, 8);
		equal(surfaceDamaged, await render(surfaceSettings, 1000), 'surface damage survives seeking');
		checks.push('finite tape damage time offset and seeking');

		// 【外部テクスチャによる欠損にも同じ1H補償が働く】
		// 専用の画像合成経路ではなく、既存の復調前の信号処理へ統合されていることを確認する。
		const surfaceCompensated = await render({ ...surfaceSettings, dropoutCompensation: true });
		assert(grayscaleError(surfaceCompensated) < grayscaleError(surfaceDamaged) * 0.5, '1H compensation also handles external tape damage');
		checks.push('external tape damage compensation');

		// 【Tracking OffsetはRF振幅に加え、テープ上の傷との交差位置も変える】
		// 対称な±0.75は同じ読取振幅になる。記録トラックと平行な傷の境界を挟み、
		// 正側だけが傷へ入る配置を使って、単なる振幅変化と区別する。
		const mapWidth = 4 * VHS_TAPE.speedMetersPerSecond;
		const parallelDamage = field(1024, 1024, 1, (x, y) => {
			const longitudinal = ((x + 0.5) / 1024 - 0.5) * mapWidth;
			const transverse = (0.5 - (y + 0.5) / 1024) * VHS_TAPE.recordedWidthMeters;
			return [transverse + longitudinal * VHS_TAPE.recordedWidthMeters / VHS_TAPE.scanLongitudinalLengthMeters > 0.000025 ? 1 : 0];
		});
		const trackingSettings = { ...clean, input: grayInput, tapeDamage: parallelDamage, rfNoiseFloor: -42 };
		const outsideDamage = await render({ ...trackingSettings, trackingOffset: -0.75 });
		const insideDamage = await render({ ...trackingSettings, trackingOffset: 0.75 });
		assert(grayscaleError(insideDamage) > grayscaleError(outsideDamage) * 4, 'tracking moves head across the surface defect');
		checks.push('tracking changes tape damage intersection');

		// 【傷マップのFitはテープ範囲を基準にし、映像出力の縦横比から独立する】
		// 出力の幅・高さを傷入力のFitに使うと、同じ媒体なのに傷の範囲が変わってしまう。
		const fittedDamage = { ...stepDamage, sampling: { ...stepDamage.sampling, fitMode: 'cover' } } as const;
		const squareEffect = createEffect(48, 48);
		const fittedSettings = { ...surfaceSettings, tapeDamage: fittedDamage };
		const wideDamage = await render(fittedSettings);
		const squareDamage = await squareEffect(fittedSettings);
		// 同じ高さの両画像は、中央の24画素が同じ走査位置をサンプルするよう幅比を選ぶ。
		// ノイズの細かなX差を避け、傷との交差位置を行ごとの平均誤差で比較する。
		let aspectDifference = 0;
		for (let y = 0; y < 48; y++) {
			const rowMean = (values: Float32Array, width: number) => {
				let sum = 0;
				for (let x = 0; x < width; x++) sum += Math.abs(values[(y * width + x) * 4] - 0.45);
				return sum / width;
			};
			aspectDifference += Math.abs(rowMean(wideDamage, 64) - rowMean(squareDamage, 48));
		}
		assert(aspectDifference / 48 < 0.035, 'damage Fit independent of image aspect ratio');
		checks.push('tape damage Fit independent of output aspect');

		// 【隙間による減衰を復調前のRF信号から実測する】
		// 最終画像だけではFMの振幅耐性に隠れてしまうため、実際のreadTape passへ
		// 既知の正弦波を入れ、低域色信号と輝度FMで異なる損失を持つことを確かめる。
		await checkHeadSpacingOnGpu(device);
		checks.push('Wallace RF frequency response');

		// 【傷・隙間・変位の定数／テクスチャの全8構成が同じ物理量を渡す】
		// ベクトル場の16bit表現は2のべき乗を使って定数と一致させ、bindingの差だけを比較する。
		const displacementValue = [2 ** -15, -(2 ** -16)];
		const displacementTexture = field(4, 4, 2, () => displacementValue);
		const separationTexture = field(4, 4, 1, () => [0.0625]);
		const damageTexture = field(4, 4, 1, () => [0.25]);
		let surfaceCombinationReference: Float32Array | null = null;
		for (let combination = 0; combination < 8; combination++) {
			const values = await render({ ...clean, input: image,
				tapeDamage: (combination & 1) !== 0 ? damageTexture : scalar(0.25),
				headSeparation: (combination & 2) !== 0 ? separationTexture : scalar(0.0625),
				tapeDisplacement: (combination & 4) !== 0 ? displacementTexture : vector(displacementValue),
			});
			if (surfaceCombinationReference == null) { surfaceCombinationReference = values; }
			else { equal(values, surfaceCombinationReference, 'surface input combination agreement'); }
		}
		checks.push('combined surface input variants');

		// 【変形した材料点へ戻ることで、トラックとの重なりと傷の参照位置が同時に変わる】
		// 読取振幅だけを掛け替えたり、傷をヘッドの未変形位置で読む実装を防ぐ。
		const surfaceWidth = 4 * VHS_TAPE.speedMetersPerSecond;
		const transverseTranslation = VHS_TAPE.trackNormal.map(component => component * 0.75 * VHS_TAPE.trackPitchMeters / surfaceWidth);
		const recoveredMaterial = await render({ ...trackingSettings, trackingOffset: 0.75, tapeDisplacement: vector(transverseTranslation) });
		assert(grayscaleError(recoveredMaterial) < grayscaleError(insideDamage) * 0.3, 'inverse displacement restores track overlap and avoids the material defect');
		const offTrack = await render({ ...clean, input: grayInput, trackingOffset: 1.25, rfNoiseFloor: -42 });
		const recoveredTrack = await render({ ...clean, input: grayInput, trackingOffset: 1.25, rfNoiseFloor: -42,
			tapeDisplacement: vector(VHS_TAPE.trackNormal.map(component => component * 1.25 * VHS_TAPE.trackPitchMeters / surfaceWidth)),
		});
		assert(grayscaleError(recoveredTrack) < grayscaleError(offTrack) * 0.2, 'displacement can recover an initially unreadable track');
		checks.push('displacement restores tracking and material damage');

		// 【トラックに沿う材料の移動はRFの読取時刻を変え、同期補正で復元できる】
		// 変位を最終画像のUVへ加えるだけの実装では、同じ復調済み同期から補正できない。
		const longitudinalTranslation = vector(VHS_TAPE.trackTangent.map(component => component * 2 ** -12));
		const displacedEdge = await render({ ...clean, input: edge, tapeDisplacement: longitudinalTranslation, timeBaseCorrection: 0 });
		const displacedCorrected = await render({ ...clean, input: edge, tapeDisplacement: longitudinalTranslation, timeBaseCorrection: 1 });
		assert(edgeError(displacedEdge) > 1, 'longitudinal material displacement changes scan timing');
		assert(edgeError(displacedCorrected) < edgeError(displacedEdge), 'TBC recovers displacement-induced timing error');
		checks.push('displacement changes RF timing and TBC recovery');

		// 【場所ごとに異なる伸びは実際のFM周波数を変える】
		// 小さな一様伸長を前方変形として入力し、逆写像と信号の再サンプリングを通す。
		const stretch = 0.02;
		const stretchField = field(128, 64, 2, (x, y) => {
			const position = [((x + 0.5) / 128 - 0.5) * surfaceWidth, (0.5 - (y + 0.5) / 64) * VHS_TAPE.recordedWidthMeters];
			const along = position[0] * VHS_TAPE.trackTangent[0] + position[1] * VHS_TAPE.trackTangent[1];
			return VHS_TAPE.trackTangent.map(component => component * along * stretch / surfaceWidth);
		}, { filterMode: 'linear' });
		const stretchedGray = await render({ ...clean, input: grayInput, tapeDisplacement: stretchField });
		let stretchedMean = 0;
		for (let x = 8; x < 56; x++) stretchedMean += stretchedGray[(22 * 64 + x) * 4] / 48;
		assert(stretchedMean > 0.2 && stretchedMean < 0.4, `stretch changes FM frequency rather than only moving the image: ${stretchedMean}`);
		checks.push('nonuniform material stretch changes FM frequency');

		// 【変形による読取位置へcoverageも移し、透明な部分に信号雑音を描かない】
		// RGBだけを移動したり、隙間・欠損をalphaへ直接掛ける実装を検出する。
		const coverageImage = field(64, 48, 4, x => x < 32 ? [0, 0, 0, 0] : [0.25, 0.25, 0.25, 0.5]);
		const originalCoverage = await render({ ...clean, input: coverageImage, timeBaseCorrection: 0 });
		const displacedCoverage = await render({ ...clean, input: coverageImage, timeBaseCorrection: 0, tapeDisplacement: longitudinalTranslation });
		assert(displacedCoverage.some((value, index) => index % 4 === 3 && value !== originalCoverage[index]), 'coverage follows material displacement');
		for (let index = 0; index < displacedCoverage.length; index += 4) {
			assert(displacedCoverage[index + 3] >= 0 && displacedCoverage[index + 3] <= 0.5, 'bounded displaced coverage');
			if (displacedCoverage[index + 3] === 0) checkColor(displacedCoverage, [0, 0, 0, 0], 'transparent displaced pixel', index, 0);
		}
		checks.push('displacement moves premultiplied coverage');

		// 【局所的な隙間は同じテープ面の一部に作用し、複合した変形もシーク後に再現する】
		// 履歴で接触率や反復解を更新する処理、画面座標で隙間を読む処理を防ぐ。
		const localSeparation = { ...stepDamage };
		const separationReference = await render({ ...clean, input: grayInput, rfNoiseFloor: -36 });
		const separated = await render({ ...clean, input: grayInput, rfNoiseFloor: -36, headSeparation: localSeparation });
		equal(separated.slice(0, 12 * 64 * 4), separationReference.slice(0, 12 * 64 * 4), 'contact maintained outside the separated region');
		assert(grayscaleError(separated) > grayscaleError(separationReference) * 4, 'local head separation degrades recovered signal');
		const combinedSettings = { ...settings, tapeDisplacement: stretchField, headSeparation: separationTexture, tapeDamage: stepDamage };
		const combined = await render(combinedSettings);
		await render({ ...combinedSettings, time: 4 }, 40);
		equal(combined, await render(combinedSettings, 200), 'deterministic deformed and separated tape');
		checks.push('local separation and deterministic surface replay');

		// 【信号計算と画像出力の保存形式を分離する】
		// 信号の符号や振幅を保持する検証に加え、画像の固定形式はcreateEffectの生成時に確認する。
		checks.push('16-bit float image output');

		const previewWidth = 512;
		const previewHeight = 384;
		const bars = [[1, 1, 1], [1, 1, 0], [0, 1, 1], [0, 1, 0], [1, 0, 1], [1, 0, 0], [0, 0, 1], [0.05, 0.05, 0.05]];
		const previewColorAt = (x: number, y: number) => {
			if (y < 144) return [...bars[Math.floor(x / 64)], 1];
			if (y < 240) return [x / 511, x / 511, x / 511, 1];
			if ((x - 256) ** 2 + (y - 306) ** 2 < 45 ** 2) return [0.1, 0.8, 1, 1];
			const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 0.1 : 0.8;
			return [value, value, value, 1];
		};
		const previewInput = field(previewWidth, previewHeight, 4, previewColorAt);
		const previewEffect = createEffect(previewWidth, previewHeight);
		const previewSeparation = field(128, 64, 1, (_x, y) => [0.35 * Math.exp(-(((y / 63 - 0.5) / 0.09) ** 2))], { filterMode: 'linear' });
		const previewDisplacement = field(128, 64, 2, (_x, y) => VHS_TAPE.trackTangent.map(component => component * 0.00004 * Math.sin(y / 63 * 6 * Math.PI)), { filterMode: 'linear' });
		const canvas = new OffscreenCanvas(previewWidth * 4, previewHeight);
		const context = canvas.getContext('2d')!;
		const original = new ImageData(previewWidth, previewHeight);
		for (let y = 0; y < previewHeight; y++) for (let x = 0; x < previewWidth; x++) {
			original.data.set(previewColorAt(x, y).map(value => Math.round(value * 255)), (y * previewWidth + x) * 4);
		}
		context.putImageData(original, 0, 0);
		for (const [index, values] of [
			await previewEffect({ input: previewInput, time: 1.25, seed: 37 }),
			await previewEffect({ input: previewInput, time: 1.25, seed: 37, trackingOffset: 0.4, trackAlignmentError: 2, dropoutRate: 1200 }),
			await previewEffect({ input: previewInput, time: 0, seed: 37, headSeparation: previewSeparation, tapeDisplacement: previewDisplacement }),
		].entries()) {
			context.putImageData(new ImageData(Uint8ClampedArray.from(values, value => Math.round(value * 255)), previewWidth, previewHeight), (index + 1) * previewWidth, 0);
		}
		const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
		return { checks, preview: btoa(Array.from(bytes, value => String.fromCharCode(value)).join('')) };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
