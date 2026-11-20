import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/gyroidGlow/_def_.ts';
import implementationNative from '../../src/fx/gyroidGlow/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { linearSrgbToSrgb } from '@gs/shared/color-space.ts';
import { evaluatePreparedColorRamp, prepareColorRamp } from '@gs/shared/color-ramp.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;

export async function run(includePreview = false, includeVariationsPreview = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.002) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => assert(actual.length === expected.length && actual.every((value, index) => value === expected[index]), label);
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.defaultValue])) as unknown as Parameters;
	defaults.orbColor = constantShaderInput('color', definition.paramDefs.orbColor.defaultValue);
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	function createEffect(width = 33, height = 33) {
		const resolution = { width, height };
		const output = implementation.createTexture('output', { wgpu, resolution });
		assert(output.format === 'rgba16float', 'image output must remain rgba16float');
		const instance = implementation.place(wgpu, resolution);
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readerGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposers.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, contextTime = 0) => {
			const encoder = device.createCommandEncoder();
			await instance.draw({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time: contextTime, timeDelta: 1000 / 30,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readerGroup);
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite pixels');
			return pixels;
		};
	}

	try {
		const render = createEffect();
		const original = await render();
		assert(original.some((value, index) => index % 4 !== 3 && value > 0.01), 'visible default image');
		assert(original.every((value, index) => index % 4 === 3 ? value === 1 : value >= 0 && value <= 1), 'opaque soft shoulder');
		checks.push('visible opaque defaults');

		// 【Timeだけがアニメーションを進め、シークと再描画で同じ結果を得る】
		// 呼び出し側の時刻・描画間隔・直前の設定へ依存すると、動画書き出しや逆再生が変わってしまう。
		const animated = await render({ time: 3.25 });
		assert(animated.some((value, index) => Math.abs(value - original[index]) > 0.05), 'explicit time changes image');
		await render({ time: -12, foldFrequency: 2, zoom: 1.5 });
		equal(await render({}, 100), original, 'render history and context time independence');
		equal(await render({ time: 3.25 }), animated, 'seek restores frame');
		checks.push('explicit time and deterministic seeking');

		// 【HDRのEV倍率とSoft Shoulderの線形出力】
		// 1超の値が残ること、+1EVで光量が倍になること、二重ガンマを含まないことを検証する。
		const hdr = await render({ toneMapping: 'hdr' });
		const brighter = await render({ toneMapping: 'hdr', exposure: 1 });
		assert(hdr.some((value, index) => index % 4 !== 3 && value > 1), 'HDR highlights');
		hdr.forEach((value, index) => {
			if (index % 4 === 3) return;
			near(brighter[index], 2 * value, 'one EV doubles linear RGB');
			near(original[index], 1 - Math.exp(-value), 'linear soft shoulder');
		});
		checks.push('HDR highlights and EV scaling', 'linear soft shoulder without gamma');

		// 【発光合成はRGBを保持し、全光源を消すと黒になる】
		// alpha=0へ切り替えた際のRGB消失と、片方のStrengthが無視される回帰を防ぐ。
		const emission = await render({ compositing: 'emission' });
		original.forEach((value, index) => near(emission[index], index % 4 === 3 ? 0 : value, 'emission retains RGB', 0));
		const dark = await render({ sheetStrength: 0, orbStrength: 0, compositing: 'emission' });
		assert(dark.every(value => value === 0), 'disabled sources are transparent black');
		const sheets = await render({ orbStrength: 0 });
		const orb = await render({ sheetStrength: 0, toneMapping: 'hdr' });
		assert(sheets.some((value, index) => Math.abs(value - original[index]) > 0.01), 'orb can be disabled');
		assert(orb.some((value, index) => index % 4 !== 3 && value > 0), 'orb remains without sheet emission');
		checks.push('emission compositing', 'independent source strengths');

		// 【通常の色alphaは一度だけ掛かり、テクスチャの発光RGBは消さない】
		// 色のalphaが重複して掛からないことを、ShaderInputの定数・テクスチャ両経路で確認する。
		const halfColor = await render({ sheetStrength: 0, toneMapping: 'hdr', orbColor: constantShaderInput('color', [1, 1, 1, 0.5]) });
		orb.forEach((value, index) => { if (index % 4 !== 3) near(halfColor[index], value * 0.25, 'single alpha before contrast'); });
		const texture = device.createTexture({ size: [2, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		disposers.push(() => texture.destroy());
		device.queue.writeTexture({ texture }, new Float16Array([1, 0, 0, 0, 0, 0, 1, 0]), { bytesPerRow: 16 }, [2, 1]);
		const textured = await render({ sheetStrength: 0, toneMapping: 'hdr', orbColor: textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }) });
		for (let y = 0; y < 33; y++) for (const x of [8, 24]) {
			const offset = (y * 33 + x) * 4;
			for (let channel = 0; channel < 3; channel++) near(textured[offset + channel], channel === (x < 16 ? 0 : 2) ? orb[offset + channel] : 0, 'emissive texture color');
		}
		checks.push('color alpha and emissive node input');

		// 【位相と回転は1周で戻り、正の回転は時計回りになる】
		// 非対称な模様を回転前の画素位置と比較し、行列の向きやturn/radianの取り違えを検出する。
		equal(await render({ colorPhase: 1 }), original, 'color phase period');
		equal(await render({ rotation: -1 }), original, 'rotation period');
		const rotated = await render({ rotation: 0.25 });
		for (let y = 0; y < 33; y += 4) for (let x = 0; x < 33; x += 4) for (let channel = 0; channel < 3; channel++) {
			near(rotated[(y * 33 + x) * 4 + channel], original[((32 - x) * 33 + y) * 4 + channel], 'clockwise quarter turn');
		}
		checks.push('periodic color phase and clockwise rotation');

		// 【解像度変更と長辺が等しい縦横比変更で同じ投影位置を保つ】
		// 3倍解像度の一致する画素中心と、正方形から短辺だけを切り詰めた共通領域を比較する。
		// 高さ基準の投影へ戻る場合や、近傍フェードの距離が解像度・縦横比へ依存する場合を検出する。
		const renderLarger = createEffect(99, 99);
		const renderWide = createEffect(33, 17);
		const renderPortrait = createEffect(17, 33);
		for (const settings of [{}, { nearEmissionFadeDistance: 0.4, nearFoldFadeDistance: 0.8 }] satisfies Partial<Parameters>[]) {
			const reference = await render(settings);
			const larger = await renderLarger(settings);
			const wide = await renderWide(settings);
			const portrait = await renderPortrait(settings);
			for (let y = 0; y < 33; y += 4) for (let x = 0; x < 33; x += 4) for (let channel = 0; channel < 3; channel++) {
				const expected = reference[(y * 33 + x) * 4 + channel];
				near(larger[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], expected, 'resolution independence');
				if (y >= 8 && y <= 24) near(wide[((y - 8) * 33 + x) * 4 + channel], expected, 'wide aspect ratio');
				if (x >= 8 && x <= 24) near(portrait[(y * 17 + x - 8) * 4 + channel], expected, 'portrait aspect ratio');
			}
		}
		checks.push('resolution and aspect ratio independence');

		// 【Zoomは画角を変え、Fold Frequencyは空間構造を変える】
		// どちらかが未接続だったり、同じ倍率へまとめられる誤りを検出する。
		const zoomed = await render({ zoom: 2 });
		const finer = await render({ foldFrequency: 2 });
		const center = (16 * 33 + 16) * 4;
		for (let channel = 0; channel < 3; channel++) near(zoomed[center + channel], original[center + channel], 'zoom preserves center ray');
		assert(zoomed.some((value, index) => Math.abs(value - original[index]) > 0.01), 'zoom changes framing');
		assert(finer.some((value, index) => Math.abs(value - zoomed[index]) > 0.01), 'fold frequency differs from zoom');
		checks.push('independent framing and fold frequency');

		// 【反復上限を減らすと光が欠け、無効値からは有限な結果へ戻る】
		// Maximum Stepsを単なる品質と誤認した正規化を加えず、HDRの保存上限も確認する。
		const shortMarch = await render({ maximumSteps: 1 });
		assert(shortMarch.some((value, index) => index % 4 !== 3 && value < original[index] - 0.01), 'step budget truncates light');
		equal(await render({ time: NaN, rotation: Infinity, zoom: NaN, colorPhase: NaN, foldFrequency: NaN, maximumSteps: NaN, maximumTraceDistance: NaN, cameraPosition: [NaN, Infinity], cameraZ: NaN }), original, 'finite defaults');
		const extreme = await render({ toneMapping: 'hdr', exposure: 20, sheetStrength: 1000, orbStrength: 1000 });
		assert(extreme.every(value => value <= 65504), 'finite half float range');
		checks.push('step budget and finite output bounds');

		// 【配色は各地点で混ざり、周期とモードの切替を保つ】
		// Constant補間でも一つのレイ上に赤と青が混在することで、描画後の色付けになっていないと確認する。
		const twoColorRamp: ColorRamp = { interpolation: 'constant', colorSpace: 'linearSrgb', repeatCount: 1, repeatMode: 'wrap', stops: [
			{ id: 'red', position: 0, color: [1, 0, 0, 1] },
			{ id: 'blue', position: 0.5, color: [0, 0, 1, 1] },
		] };
		const rampSettings: Partial<Parameters> = { colorMode: 'colorRamp', ramp: twoColorRamp, orbStrength: 0, toneMapping: 'hdr' };
		const mixed = await render({ ...rampSettings, foldAmount: 0, sheetTilt: [0, 0] });
		assert(mixed[center] > 0 && mixed[center + 1] === 0 && mixed[center + 2] > 0, 'ramp colors mix along the ray');
		const rampImage = await render(rampSettings);
		equal(await render({ ...rampSettings, colorPhase: -2 }), rampImage, 'ramp phase wraps for negative cycles');
		assert((await render({ ...rampSettings, colorFrequency: 2 })).some((value, index) => Math.abs(value - rampImage[index]) > 0.01), 'color frequency changes band distribution');
		equal(await render({ ramp: twoColorRamp }), original, 'cosine ignores ramp colors');
		checks.push('per-step ramp colors and periodicity');

		// 【Rampのalphaを一度だけ掛け、HDRをクランプせずに発光へ渡す】
		// 単色の光量比から、二重alpha・0〜1への制限・出力alphaとの混同を検出する。
		const whiteRamp: ColorRamp = { interpolation: 'linear', colorSpace: 'linearSrgb', repeatCount: 1, repeatMode: 'wrap', stops: [{ id: 'white', position: 0, color: [1, 1, 1, 1] }] };
		const whiteSheets = await render({ ...rampSettings, ramp: whiteRamp });
		const transparentRamp: ColorRamp = { ...whiteRamp, stops: [{ id: 'transparent', position: 0, color: [1, 0.5, 2, 0] }] };
		for (const [component, alpha] of [[1, 0.5], [2, 1]]) {
			const ramp: ColorRamp = { ...whiteRamp, stops: [{ id: 'color', position: 0, color: [component, component, component, alpha] }] };
			const pixels = await render({ ...rampSettings, ramp });
			whiteSheets.forEach((value, index) => near(pixels[index], index % 4 === 3 ? 1 : value * (component * alpha) ** 2, 'ramp emission scales before contrast'));
		}
		equal(await render({ colorMode: 'colorRamp', ramp: transparentRamp, toneMapping: 'hdr' }), orb, 'transparent ramp removes only sheet emission');
		checks.push('ramp alpha and HDR emission');

		// 【色周波数0では選んだ位相の色を各地点で使い、補間方式・色空間を尊重する】
		// 既知の単色出力との比で照合し、レイマーチ自体の式はテストへ複製しない。
		for (const colorSpace of ['linearSrgb', 'srgb', 'oklab', 'oklch'] as const) {
			const ramp: ColorRamp = { colorSpace, interpolation: 'smoothstep', repeatCount: 1, repeatMode: 'wrap', stops: [
				{ id: 'start', position: 0, color: [0.8, 0.1, 0.2, 0.8] },
				{ id: 'end', position: 1, color: [0.1, 0.5, 0.9, 0.4] },
			] };
			const selectedColor = evaluatePreparedColorRamp(prepareColorRamp(ramp), 0.25);
			const pixels = await render({ ...rampSettings, ramp, colorFrequency: 0, colorPhase: -0.25 });
			whiteSheets.forEach((value, index) => {
				if (index % 4 !== 3) near(pixels[index], value * selectedColor[index % 4] ** 2, 'selected ramp color and interpolation');
			});
		}
		checks.push('ramp interpolation and zero color frequency');

		// 【stop数の増減と色の編集を同じエフェクトへ即時反映する】
		// bufferの再確保やモード切替で古い配色を使い続けたり、bindingを失う回帰を防ぐ。
		const manyStops: ColorRamp = { ...whiteRamp, stops: Array.from({ length: 64 }, (_, index) => ({
			id: `stop-${index}`, position: index / 63, color: [1, 1, 1, 1],
		})) };
		equal(await render({ ...rampSettings, ramp: manyStops }), whiteSheets, 'expanded stop buffer');
		equal(await render({ ...rampSettings, ramp: whiteRamp }), whiteSheets, 'shrunk stop buffer');
		equal(await render(rampSettings), rampImage, 'edited ramp is restored');
		equal(await render(), original, 'cosine mode is restored');
		checks.push('ramp updates and stop buffer resizing');

		// 【うねりを消すと周波数や流動時刻に依存しない平面状の場になる】
		// Fold Amountが配色や光量の倍率へ誤接続されず、膜の構造を制御することを確認する。
		const planeSettings: Partial<Parameters> = { ...rampSettings, ramp: whiteRamp, colorFrequency: 0, foldAmount: 0, sheetTilt: [0, 0] };
		const plane = await render(planeSettings);
		equal(await render({ ...planeSettings, foldFrequency: 5, time: 19 }), plane, 'zero folds ignore flow and frequency');
		plane.forEach((value, index) => near(value, plane[index % 4], 'zero tilt and folds are spatially uniform', 0));
		assert((await render({ ...planeSettings, foldAmount: 2 })).some((value, index) => Math.abs(value - plane[index]) > 0.01), 'fold amount changes geometry');
		for (const axis of [0, 1]) {
			const positiveTilt = await render({ ...planeSettings, sheetTilt: axis === 0 ? [1, 0] : [0, 1] });
			const negativeTilt = await render({ ...planeSettings, sheetTilt: axis === 0 ? [-1, 0] : [0, -1] });
			assert(positiveTilt.some((value, index) => Math.abs(value - plane[index]) > 0.01), 'tilt changes geometry');
			for (let y = 0; y < 33; y += 4) for (let x = 0; x < 33; x += 4) {
				const mirrored = ((axis === 1 ? 32 - y : y) * 33 + (axis === 0 ? 32 - x : x)) * 4;
				near(positiveTilt[(y * 33 + x) * 4], negativeTilt[mirrored], 'tilt sign reflects its axis');
			}
		}
		checks.push('fold amount and independent tilt axes');

		// 【カメラのXYZを共通単位の位置として扱い、発光球を固定空間に保つ】
		// 時刻0の球は[0, 0.475, -0.4]。中心レイの逆二乗発光の解析積分と照合し、
		// 単位・Zの向き・原点の誤りや、カメラ移動に球が追従する実装を検出する。
		const renderCenter = createEffect(1, 1);
		for (const [cameraX, cameraY, cameraZ] of [[0, 0.475, 0.8], [0.2, 0.475, 0.8], [0, 0.675, 0.8], [0, 0.475, 1.6], [0, 0.475, -0.8]]) {
			const maximumTraceDistance = 2.5;
			const pixels = await renderCenter({
				cameraPosition: [cameraX, cameraY], cameraZ, maximumTraceDistance, maximumSteps: 2048,
				sheetStrength: 0, foldAmount: 0, sheetTilt: [0, -0.6 / (2 * cameraY * 0.45)], toneMapping: 'hdr',
			});
			const perpendicularDistance = Math.sqrt(cameraX ** 2 + (cameraY - 0.475) ** 2 + 0.00125);
			const forwardDistance = cameraZ + 0.4;
			const light = 100 / perpendicularDistance * (Math.atan((maximumTraceDistance - forwardDistance) / perpendicularDistance) - Math.atan(-forwardDistance / perpendicularDistance));
			near(pixels[0] / (light ** 2 * 8e-8), 1, 'camera position in fixed world units', 0.015);
		}
		checks.push('absolute camera XYZ and fixed orb coordinates');

		// 【カメラ移動は膜の配置を変えず、画角と回転は移動先の視点に適用する】
		// Xだけに依存する膜をY/Z方向へ動いて見ても同じ像になる。X方向では見える膜が変わる。
		// 移動を画面の後処理やZoomで代用したり、カメラの周囲へ膜を再配置する回帰を防ぐ。
		const cameraPlaneSettings: Partial<Parameters> = { ...planeSettings, sheetTilt: [1, 0], maximumSteps: 512, maximumTraceDistance: 2 };
		const cameraPlane = await render(cameraPlaneSettings);
		equal(await render({ ...cameraPlaneSettings, cameraPosition: [0, 0.4], cameraZ: -2 }), cameraPlane, 'world plane ignores parallel camera translation');
		const shiftedPlane = await render({ ...cameraPlaneSettings, cameraPosition: [0.2, 0.4], cameraZ: -2 });
		assert(shiftedPlane.some((value, index) => Math.abs(value - cameraPlane[index]) > 0.01), 'camera crosses fixed plane');
		const shifted = await render({ cameraPosition: [0.2, -0.1], cameraZ: 0.4 });
		const shiftedZoomed = await render({ cameraPosition: [0.2, -0.1], cameraZ: 0.4, zoom: 2 });
		const shiftedRotated = await render({ cameraPosition: [0.2, -0.1], cameraZ: 0.4, rotation: 0.25 });
		for (let channel = 0; channel < 3; channel++) near(shiftedZoomed[center + channel], shifted[center + channel], 'zoom preserves translated center ray');
		for (let y = 0; y < 33; y += 4) for (let x = 0; x < 33; x += 4) for (let channel = 0; channel < 3; channel++) {
			near(shiftedRotated[(y * 33 + x) * 4 + channel], shifted[((32 - x) * 33 + y) * 4 + channel], 'rotation around translated camera');
		}
		checks.push('world-fixed sheets and camera framing');

		// 【120回を超える反復を許可し、2048回で計算量を制限する】
		// 十分な描画距離を与え、距離の制限で偶然同じ像になる場合と区別する。
		const longMarchSettings: Partial<Parameters> = { ...planeSettings, maximumTraceDistance: 1000 };
		const budget120 = await renderCenter({ ...longMarchSettings, maximumSteps: 120 });
		const budget256 = await renderCenter({ ...longMarchSettings, maximumSteps: 256 });
		const budget2048 = await renderCenter({ ...longMarchSettings, maximumSteps: 2048 });
		assert(budget256[0] > budget120[0] && budget2048[0] > budget256[0], 'expanded step budget adds distant light');
		equal(await renderCenter({ ...longMarchSettings, maximumSteps: 4096 }), budget2048, 'maximum step clamp');
		equal(await renderCenter({ ...longMarchSettings, maximumSteps: 255.6 }), budget256, 'integer step budget');
		checks.push('expanded step budget up to 2048');

		// 【描画距離0は黒になり、最後の区間から範囲外の発光を加えない】
		// 1歩より短い距離では同じ球のサンプルでも積分区間だけが変わり、HDRは距離の二乗に比例する。
		// 反復数を増やしても距離の制限を越えないこと、負の距離も0へ制限することを確認する。
		const traceSettings: Partial<Parameters> = { sheetStrength: 0, foldAmount: 0, sheetTilt: [0, 0], toneMapping: 'hdr', exposure: 10 };
		const shortTrace = await renderCenter({ ...traceSettings, maximumTraceDistance: 0.02, maximumSteps: 1 });
		const halfTrace = await renderCenter({ ...traceSettings, maximumTraceDistance: 0.01, maximumSteps: 2048 });
		assert(shortTrace[0] > 0, 'short range still emits light');
		near(halfTrace[0] / shortTrace[0], 0.25, 'last integration interval is clipped');
		equal(await renderCenter({ ...traceSettings, maximumTraceDistance: 0.02, maximumSteps: 2048 }), shortTrace, 'trace distance terminates before step budget');
		const zeroTrace = await render({ maximumTraceDistance: 0 });
		assert(zeroTrace.every((value, index) => value === (index % 4 === 3 ? 1 : 0)), 'zero distance is opaque black');
		equal(await render({ maximumTraceDistance: -1 }), zeroTrace, 'negative distance is clamped to zero');
		assert((await render({ maximumTraceDistance: 0, compositing: 'emission' })).every(value => value === 0), 'zero distance emission is transparent black');
		const shortSheetTrace = await renderCenter({ ...planeSettings, nearEmissionFadeDistance: 1, maximumTraceDistance: 0.02, exposure: 20 });
		const halfSheetTrace = await renderCenter({ ...planeSettings, nearEmissionFadeDistance: 1, maximumTraceDistance: 0.01, exposure: 20 });
		assert(shortSheetTrace[0] > 0 && halfSheetTrace[0] < shortSheetTrace[0] * 0.25, 'sheet emission fades continuously at short range');
		checks.push('trace distance clipping and zero range');

		// 【最大描画距離はZ深度ではなく正規化したレイに沿った長さ】
		// 一様な発光場を端数区間で打ち切り、画面端でも同じ積分長になることを確認する。
		const uniformTrace = await render({ ...planeSettings, maximumTraceDistance: 1.37, maximumSteps: 2048 });
		uniformTrace.forEach((value, index) => near(value, uniformTrace[index % 4], 'trace length is independent of ray direction', 0));
		checks.push('trace distance measured along each ray');

		// 【発光とうねりの抑制を別々に切り替え、発光の抑制は球へ影響させない】
		// 四つの組み合わせで膜の発光を比較する。球だけの出力は厳密に一致させ、
		// 発光フェードを歩幅や合計光量へ誤って適用していないことも確認する。
		for (const nearFoldFadeDistance of [0, 1]) {
			const sheetSettings: Partial<Parameters> = { ...rampSettings, ramp: whiteRamp, nearFoldFadeDistance };
			const unfadedSheets = await render({ ...sheetSettings, nearEmissionFadeDistance: 0 });
			const fadedSheets = await render({ ...sheetSettings, nearEmissionFadeDistance: 1 });
			assert(fadedSheets.every((value, index) => value <= unfadedSheets[index]), 'emission fade only reduces white sheet emission');
			assert(unfadedSheets.some((value, index) => value > fadedSheets[index] + 0.001), 'emission fade is independently switchable');
			const orbSettings: Partial<Parameters> = { sheetStrength: 0, nearFoldFadeDistance, toneMapping: 'hdr' };
			const referenceOrb = await render(orbSettings);
			for (const nearEmissionFadeDistance of [0, 0.25, 2]) {
				equal(await render({ ...orbSettings, nearEmissionFadeDistance }), referenceOrb, 'emission fade leaves orb and marching unchanged');
			}
		}
		checks.push('independent near fades and unaffected orb emission');

		// 【発光フェードの距離を広げると、範囲内の光量が距離に反比例する】
		// 全サンプルを両設定のフェード範囲内に置き、距離を2倍にすると二乗後のHDRが1/4になる。
		// 単なるON/OFFやZ深度ではなく、共通単位の距離を使っていることを確認する。
		const emissionFadeSettings: Partial<Parameters> = { ...planeSettings, maximumTraceDistance: 0.5, exposure: 10 };
		const fadeDistanceOne = await renderCenter({ ...emissionFadeSettings, nearEmissionFadeDistance: 1 });
		const fadeDistanceTwo = await renderCenter({ ...emissionFadeSettings, nearEmissionFadeDistance: 2 });
		assert(fadeDistanceOne[0] > 0, 'finite visible near emission');
		near(fadeDistanceTwo[0] / fadeDistanceOne[0], 0.25, 'emission fade distance scales linear light');
		checks.push('near emission fade distance controls falloff');

		// 【うねりの抑制は移動先のカメラから始まり、傾きと歩幅の計算を保つ】
		// 先頭サンプルではうねりだけが0になるので、Fold Amount=0と同じ出力になる。
		// カメラを移動して比較し、初期位置への固定や陰関数全体への乗算を検出する。
		const firstSampleSettings: Partial<Parameters> = {
			...rampSettings, ramp: whiteRamp, cameraPosition: [0.2, -0.1], cameraZ: 0.4,
			nearEmissionFadeDistance: 0, maximumSteps: 1, exposure: 10,
		};
		const unfoldedFirstSample = await renderCenter({ ...firstSampleSettings, foldAmount: 0 });
		const fadedFirstSample = await renderCenter({ ...firstSampleSettings, nearFoldFadeDistance: 1 });
		equal(fadedFirstSample, unfoldedFirstSample, 'fold fade starts at translated camera and preserves tilt');
		const fullFirstSample = await renderCenter({ ...firstSampleSettings, nearFoldFadeDistance: 0 });
		assert(Math.abs(fullFirstSample[0] - unfoldedFirstSample[0]) > 0.00001, 'zero fold fade distance keeps local folds');
		equal(await render({ ...planeSettings, nearFoldFadeDistance: 2 }), plane, 'fold fade has no effect when folds are disabled');
		const foldFadeImage = await render({ nearFoldFadeDistance: 1 });
		const unfoldedImage = await render({ nearFoldFadeDistance: 0 });
		assert(foldFadeImage.some((value, index) => Math.abs(value - unfoldedImage[index]) > 0.01), 'fold fade changes sheet geometry');
		assert((await render({ nearFoldFadeDistance: 2 })).some((value, index) => Math.abs(value - foldFadeImage[index]) > 0.01), 'fold fade distance changes its extent');
		equal(await render({ nearFoldFadeDistance: 1 }, 123), foldFadeImage, 'near fades remain deterministic after parameter edits');
		checks.push('camera-relative fold suppression and independent tilt');

		// 【近傍フェードの無効値・負値・極小値から有限な結果を生成する】
		// 距離0は抑制の無効化であり発光の消去ではない。0除算や極小距離によるオーバーフローを防ぐ。
		equal(await render({ nearEmissionFadeDistance: NaN, nearFoldFadeDistance: Infinity }), original, 'near fade finite defaults');
		const noNearFades = await render({ nearEmissionFadeDistance: 0, nearFoldFadeDistance: 0 });
		equal(await render({ nearEmissionFadeDistance: -1, nearFoldFadeDistance: -2 }), noNearFades, 'negative near fade distances disable suppression');
		for (const distance of [1e-38, 1e-45]) {
			await render({ nearEmissionFadeDistance: distance, nearFoldFadeDistance: distance });
		}
		equal(await renderCenter({ nearEmissionFadeDistance: 2000, nearFoldFadeDistance: 2000 }), await renderCenter({ nearEmissionFadeDistance: 1000, nearFoldFadeDistance: 1000 }), 'near fade distance bounds');
		checks.push('near fade zero and finite parameter bounds');

		// 【発光幅を広げても歩幅や発光球を変えず、膜の光だけを広げる】
		// 幅を歩幅の式へ流用すると、見える奥行きと発光球まで変わるため、球だけの出力を厳密比較する。
		for (const glowWidth of [0, 0.25, 4]) {
			equal(await render({ sheetStrength: 0, glowWidth, toneMapping: 'hdr' }), orb, 'glow width does not change orb integration');
		}
		equal(await render({ glowWidth: 0, toneMapping: 'hdr' }), orb, 'zero width removes only sheet emission');
		const narrowSheets = await render({ ...rampSettings, ramp: whiteRamp, glowWidth: 0.25 });
		const wideSheets = await render({ ...rampSettings, ramp: whiteRamp, glowWidth: 4 });
		assert(whiteSheets.every((value, index) => narrowSheets[index] <= value && wideSheets[index] >= value), 'glow width increases off-sheet emission');
		assert(wideSheets.some((value, index) => value > whiteSheets[index] + 0.01), 'glow width has visible influence');
		checks.push('glow width independent of marching');

		// 【形状と配色の新しい係数でも無効値と境界値から有限な画像を生成する】
		// 幅0の除算や負の倍率による反転を避け、入力の上限を変えても描画を破綻させない。
		equal(await render({ foldAmount: NaN, sheetTilt: [NaN, Infinity], glowWidth: NaN, colorFrequency: Infinity }), original, 'new parameter finite defaults');
		equal(await render({ ...planeSettings, foldAmount: -1, glowWidth: -1 }), await render({ ...planeSettings, glowWidth: 0 }), 'nonnegative shape parameters');
		await render({ ...rampSettings, foldAmount: 16, sheetTilt: [-16, 16], glowWidth: 0.000001, colorFrequency: 100 });
		await render({ ...rampSettings, foldAmount: 16, sheetTilt: [16, -16], glowWidth: 100, exposure: 20 });
		checks.push('shape and palette parameter bounds');

		let preview: string | null = null;
		if (includePreview) {
			const width = 640;
			const height = 360;
			const pixels = await createEffect(width, height)();
			const image = new ImageData(width, height);
			for (let index = 0; index < width * height; index++) {
				const encoded = linearSrgbToSrgb([...pixels.subarray(index * 4, index * 4 + 4)]);
				for (let channel = 0; channel < 4; channel++) image.data[index * 4 + channel] = Math.round(encoded[channel] * 255);
			}
			const canvas = new OffscreenCanvas(width, height);
			canvas.getContext('2d')!.putImageData(image, 0, 0);
			preview = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()).toBase64();
		}
		let variationsPreview: string | null = null;
		if (includeVariationsPreview) {
			const width = 480;
			const height = 270;
			const labelHeight = 32;
			const examples: { label: string; params: Partial<Parameters> }[] = [
				{ label: 'Cosine / default shape', params: {} },
				{ label: 'Color Ramp / default shape', params: { colorMode: 'colorRamp' } },
				{ label: 'Color Ramp / stronger folds, narrow glow', params: { colorMode: 'colorRamp', foldAmount: 2, sheetTilt: [-0.4, 0.7], glowWidth: 0.4 } },
				{ label: 'Color Ramp / gentler folds, wide glow', params: { colorMode: 'colorRamp', foldAmount: 0.35, sheetTilt: [0.8, 0.2], glowWidth: 2.5, colorFrequency: 0.5 } },
				{ label: 'Camera XY (0.2, -0.1) / Z 0.4', params: { cameraPosition: [0.2, -0.1], cameraZ: 0.4 } },
				{ label: 'Trace distance 12 / 2048 steps', params: { maximumTraceDistance: 12, maximumSteps: 2048 } },
				{ label: 'Near fades / emission 0, folds 0', params: { nearEmissionFadeDistance: 0, nearFoldFadeDistance: 0 } },
				{ label: 'Near fades / emission 1, folds 0', params: { nearEmissionFadeDistance: 1, nearFoldFadeDistance: 0 } },
				{ label: 'Near fades / emission 0, folds 1', params: { nearEmissionFadeDistance: 0, nearFoldFadeDistance: 1 } },
				{ label: 'Near fades / emission 1, folds 1', params: { nearEmissionFadeDistance: 1, nearFoldFadeDistance: 1 } },
			];
			const canvas = new OffscreenCanvas(width * 2, (height + labelHeight) * Math.ceil(examples.length / 2));
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#151515';
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = '#eeeeee';
			context.font = '14px sans-serif';
			const renderExample = createEffect(width, height);
			for (const [exampleIndex, example] of examples.entries()) {
				const pixels = await renderExample(example.params);
				const image = new ImageData(width, height);
				for (let index = 0; index < width * height; index++) {
					const encoded = linearSrgbToSrgb([...pixels.subarray(index * 4, index * 4 + 4)]);
					for (let channel = 0; channel < 4; channel++) image.data[index * 4 + channel] = Math.round(encoded[channel] * 255);
				}
				const x = exampleIndex % 2 * width;
				const y = Math.floor(exampleIndex / 2) * (height + labelHeight);
				context.fillText(example.label, x + 12, y + 22);
				context.putImageData(image, x, y + labelHeight);
			}
			variationsPreview = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()).toBase64();
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, preview, variationsPreview };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}
