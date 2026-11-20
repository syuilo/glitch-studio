import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/nebula/_def_.ts';
import implementationNative from '../../src/fx/nebula/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { linearSrgbToSrgb } from '@gs/shared/color-space.ts';
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
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.defaultValue.value])) as unknown as Parameters;

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
		const renderCenter = createEffect(1, 1);
		const baseline = await render();
		// 【初期設定で可視の雲と透過率を生成する】
		// コンパイル成功だけで空画像を見逃さず、吸収を被覆として保持することを確認する。
		assert(baseline.some((value, index) => index % 4 !== 3 && value > 0.05), 'visible cloud');
		assert(baseline.every(value => value >= 0 && value <= 1), 'soft shoulder bounds');
		assert(baseline.some((value, index) => index % 4 === 3 && value > 0 && value < 0.99), 'partial volume opacity');
		checks.push('visible volumetric defaults');

		// 【時間・Seedを戻すと描画履歴によらず同じ雲になる】
		// 停止や逆再生でも一致し、近接した大きなSeedをf32へ丸めて同一化しない。
		const animated = await render({ time: 4 });
		assert(animated.some((value, index) => Math.abs(value - baseline[index]) > 0.02), 'time changes cloud');
		await render({ time: -12, seed: 9 });
		equal(await render({}, 100), baseline, 'context time and history independence');
		equal(await render({ time: 4 }), animated, 'seek restores frame');
		const seedA = await render({ seed: 16777216 });
		const seedB = await render({ seed: 16777217 });
		assert(seedA.some((value, index) => Math.abs(value - seedB[index]) > 0.02), 'distinct large seeds');
		equal(await render({ seed: 16777216 }), seedA, 'seed restores cloud');
		checks.push('deterministic time and seeds');

		// 【速度0で静止し、流れのXYZを個別に指定できる】
		// 時刻からの不要な自動回転や、公開している速度の未接続を検出する。
		equal(await render({ time: 100, flow: [0, 0], flowZ: 0 }), baseline, 'zero flow freezes cloud');
		for (const velocity of [{ flow: [0.1, 0] as [number, number], flowZ: 0 }, { flow: [0, 0.1] as [number, number], flowZ: 0 }, { flow: [0, 0] as [number, number], flowZ: 0.1 }]) {
			assert((await render({ ...velocity, time: 3 })).some((value, index) => Math.abs(value - baseline[index]) > 0.01), 'each flow axis changes cloud');
		}
		checks.push('independent flow axes');

		// 【一様な体積で発光・吸収の解析解へ一致する】
		// 雲の中心にカメラを置き、縁へ届かない区間を描く。刻み幅・区間の端数・反復数を
		// 変えても光量を保つことで、単純なサンプル加算や積分区間のはみ出しを検出する。
		const whiteRamp: ColorRamp = { interpolation: 'linear', colorSpace: 'linearSrgb', repeatCount: 1, repeatMode: 'wrap', stops: [{ id: 'white', position: 0, color: [1, 1, 1, 1] }] };
		const uniformSettings: Partial<Parameters> = { centerZ: 0.8, radius: 2, coverage: 1, density: 1.5, emission: 2, absorption: 0.7, ramp: whiteRamp, toneMapping: 'hdr', maximumTraceDistance: 0.4 };
		const expectedOpacity = 1 - Math.exp(-1.5 * 0.7 * 0.4);
		const expectedRadiance = 2 / 0.7 * expectedOpacity;
		for (const stepSize of [0.4, 0.1, 0.025, 0.013]) {
			const pixels = await renderCenter({ ...uniformSettings, stepSize });
			near(pixels[0], expectedRadiance, 'analytic radiance');
			near(pixels[3], expectedOpacity, 'analytic opacity');
		}
		const truncated = await renderCenter({ ...uniformSettings, stepSize: 0.1, maximumTraceDistance: 0.23 });
		near(truncated[0], 2 / 0.7 * (1 - Math.exp(-1.5 * 0.7 * 0.23)), 'clipped final segment');
		const budgetLimited = await renderCenter({ ...uniformSettings, stepSize: 0.1, maximumSteps: 1 });
		near(budgetLimited[0], 2 / 0.7 * (1 - Math.exp(-1.5 * 0.7 * 0.1)), 'step budget limits integrated length');
		checks.push('analytic emission and absorption across step sizes');

		// 【吸収0の極限でも発光が残り、発光0でも背景を吸収する】
		// 0除算・alphaの二重乗算・発光と吸収の意図しない連動を防ぐ。
		const noAbsorption = await renderCenter({ ...uniformSettings, absorption: 0 });
		near(noAbsorption[0], 2 * 1.5 * 0.4, 'zero absorption integral');
		near(noAbsorption[3], 0, 'zero absorption retains emission at alpha zero', 0);
		near((await renderCenter({ ...uniformSettings, absorption: 1e-7 }))[0], noAbsorption[0], 'continuous low absorption');
		const noEmission = await renderCenter({ ...uniformSettings, emission: 0 });
		near(noEmission[0], 0, 'zero emission', 0);
		near(noEmission[3], expectedOpacity, 'absorption without emission');
		const highAbsorption = await renderCenter({ ...uniformSettings, absorption: 3 });
		assert(highAbsorption[0] < expectedRadiance && highAbsorption[3] > expectedOpacity, 'absorption attenuates light and background');
		checks.push('independent absorption and emission');

		// 【長辺基準で同じ投影位置を維持する】
		// 画面の共通領域を比較し、解像度への依存や高さ基準への回帰を検出する。
		const larger = await createEffect(99, 99)();
		const wide = await createEffect(33, 17)();
		const portrait = await createEffect(17, 33)();
		for (let y = 0; y < 33; y += 4) for (let x = 0; x < 33; x += 4) for (let channel = 0; channel < 4; channel++) {
			const expected = baseline[(y * 33 + x) * 4 + channel];
			near(larger[((y * 3 + 1) * 99 + x * 3 + 1) * 4 + channel], expected, 'resolution independence');
			if (y >= 8 && y <= 24) near(wide[((y - 8) * 33 + x) * 4 + channel], expected, 'long-side wide projection');
			if (x >= 8 && x <= 24) near(portrait[(y * 17 + x - 8) * 4 + channel], expected, 'long-side portrait projection');
		}
		checks.push('resolution and aspect independence');

		// 【カメラと雲の共通単位・視線・回転を揃える】
		// 両者を同じ量だけ動かすと相対配置が一致し、カメラだけを動かすと像が変わる。
		const translated = await render({ cameraPosition: [0.25, -0.5], cameraZ: 1.3, center: [0.25, -0.5], centerZ: -0.7 });
		translated.forEach((value, index) => near(value, baseline[index], 'shared world coordinates'));
		assert((await render({ cameraPosition: [0.25, -0.5], cameraZ: 1.3 })).some((value, index) => Math.abs(value - baseline[index]) > 0.02), 'camera moves through fixed cloud');
		const rotated = await render({ rotation: 0.25 });
		const zoomed = await render({ zoom: 2 });
		const center = (16 * 33 + 16) * 4;
		for (let channel = 0; channel < 4; channel++) near(zoomed[center + channel], baseline[center + channel], 'zoom preserves center ray');
		for (let y = 0; y < 33; y += 4) for (let x = 0; x < 33; x += 4) for (let channel = 0; channel < 4; channel++) {
			near(rotated[(y * 33 + x) * 4 + channel], baseline[((32 - x) * 33 + y) * 4 + channel], 'clockwise rotation');
		}
		checks.push('world camera and framing');

		// 【空の雲・範囲外・雲の後方では透明な黒を返す】
		// 接線や半径0での不正な交差、カメラからの最大距離の解釈違いを検出する。
		for (const settings of [{ density: 0 }, { radius: 0 }, { coverage: 0 }, { maximumTraceDistance: 0 }, { maximumTraceDistance: 0.49 }, { cameraPosition: [10, 0] as [number, number] }, { cameraZ: -4 }]) {
			assert((await render(settings)).every(value => value === 0), 'empty or out-of-range volume');
		}
		const black = await render({ radius: 0, compositing: 'opaque' });
		assert(black.every((value, index) => value === (index % 4 === 3 ? 1 : 0)), 'opaque empty volume');
		checks.push('empty volume and ray intersection limits');

		// 【Rampのalphaは発光量へ一度だけ掛かり、吸収とは分離する】
		// 色の負値・HDRを保持し、吸収率をRampの透明度で消さない。
		const tintedRamp: ColorRamp = { ...whiteRamp, stops: [{ id: 'tint', position: 0, color: [2, 0.5, -1, 0.5] }] };
		const tinted = await renderCenter({ ...uniformSettings, ramp: tintedRamp });
		for (const [channel, factor] of [1, 0.25, -0.5].entries()) near(tinted[channel], expectedRadiance * factor, 'linear ramp emission');
		near(tinted[3], expectedOpacity, 'palette-independent opacity');
		const transparentRamp: ColorRamp = { ...whiteRamp, stops: [{ id: 'invisible', position: 0, color: [1, 1, 1, 0] }] };
		const darkCloud = await renderCenter({ ...uniformSettings, ramp: transparentRamp });
		near(darkCloud[0], 0, 'transparent ramp removes emission', 0);
		near(darkCloud[3], expectedOpacity, 'transparent ramp retains absorption');
		const manyStops: ColorRamp = { ...whiteRamp, stops: Array.from({ length: 64 }, (_, index) => ({ id: String(index), position: index / 63, color: [1, 1, 1, 1] })) };
		const white = await renderCenter(uniformSettings);
		equal(await renderCenter({ ...uniformSettings, ramp: manyStops }), white, 'expanded ramp buffer');
		equal(await renderCenter(uniformSettings), white, 'shrunk ramp buffer');
		checks.push('ramp alpha HDR and buffer updates');

		// 【合成方式はRGBを保ち、トーン処理は線形光とEVへ適用する】
		// alphaの再乗算・二重ガンマ・発光RGBの消失を防ぐ。
		const hdr = await render({ toneMapping: 'hdr' });
		const brighter = await render({ toneMapping: 'hdr', exposure: 1 });
		const opaque = await render({ compositing: 'opaque' });
		const emission = await render({ compositing: 'emission' });
		baseline.forEach((value, index) => {
			if (index % 4 === 3) {
				near(opaque[index], 1, 'opaque alpha', 0);
				near(emission[index], 0, 'emission alpha', 0);
				near(brighter[index], value, 'exposure does not change absorption', 0);
			} else {
				near(value, 1 - Math.exp(-hdr[index]), 'linear soft shoulder');
				near(brighter[index], hdr[index] * 2, 'one EV doubles radiance');
				near(opaque[index], value, 'opaque retains radiance', 0);
				near(emission[index], value, 'emission retains radiance', 0);
			}
		});
		checks.push('compositing exposure and linear tone mapping');

		// 【雲量・周波数・乱流・詳細・配色を独立に編集できる】
		// UI上の設定を増やしただけでuniformや場へ接続し忘れる回帰を防ぐ。
		for (const settings of [{ coverage: 0.7 }, { noiseFrequency: 5 }, { turbulence: 0 }, { octaves: 1 }, { colorOffset: 0.4 }, { radius: 0.8 }]) {
			assert((await render(settings)).some((value, index) => Math.abs(value - baseline[index]) > 0.02), 'editable cloud structure and palette');
		}
		checks.push('editable cloud structure and palette');

		// 【歩幅を細かくすると一定の区間積分へ収束する】
		// 大きな反復予算を与え、歩幅変更が描画距離の短縮にならない条件で比較する。
		const reference = await render({ toneMapping: 'hdr', stepSize: 0.00625, maximumSteps: 1024 });
		const coarse = await render({ toneMapping: 'hdr', stepSize: 0.1, maximumSteps: 1024 });
		const fine = await render({ toneMapping: 'hdr', stepSize: 0.0125, maximumSteps: 1024 });
		const meanError = (pixels: Float32Array) => pixels.reduce((sum, value, index) => sum + Math.abs(value - reference[index]), 0) / pixels.length;
		assert(meanError(fine) < meanError(coarse) && meanError(fine) < 0.01, 'step size converges without brightening');
		checks.push('integration convergence');

		// 【2048回まで反復でき、超過を制限する】
		// 雲の一様部分で反復上限へ先に達する条件とし、距離による終了と区別する。
		const budgetSettings: Partial<Parameters> = { ...uniformSettings, stepSize: 0.0001, maximumTraceDistance: 1 };
		const budget120 = await renderCenter({ ...budgetSettings, maximumSteps: 120 });
		const budget256 = await renderCenter({ ...budgetSettings, maximumSteps: 256 });
		const budget2048 = await renderCenter({ ...budgetSettings, maximumSteps: 2048 });
		assert(budget120[0] < budget256[0] && budget256[0] < budget2048[0], 'step budget reaches farther');
		equal(await renderCenter({ ...budgetSettings, maximumSteps: 10000 }), budget2048, 'step budget clamp');
		checks.push('bounded step budget');

		// 【非有限値は既定値へ戻し、極端な設定でも有限な出力を保つ】
		// f32への書き込みや半径・吸収・歩幅の除算によるNaN伝播を防ぐ。
		const invalid: Partial<Parameters> = { time: NaN, seed: Infinity, cameraPosition: [NaN, Infinity], cameraZ: NaN, center: [Infinity, NaN], centerZ: NaN,
			radius: NaN, density: NaN, coverage: NaN, zoom: NaN, rotation: Infinity, noiseFrequency: NaN, octaves: NaN, turbulence: NaN,
			flow: [NaN, Infinity], flowZ: NaN, colorOffset: NaN, emission: NaN, absorption: NaN, exposure: NaN, stepSize: NaN, maximumSteps: NaN, maximumTraceDistance: NaN };
		equal(await render(invalid), baseline, 'nonfinite defaults');
		await renderCenter({ ...uniformSettings, exposure: 20, emission: 1000, density: 100, absorption: 0 });
		await renderCenter({ time: 1e9, noiseFrequency: 64, turbulence: 16, octaves: 6, absorption: 100, stepSize: 0, maximumSteps: 2048 });
		assert((await renderCenter({ radius: -1 })).every(value => value === 0), 'negative radius is empty');
		checks.push('finite parameter bounds');

		async function previewImage(examples: { label: string; params: Partial<Parameters> }[], width: number, height: number, columns: number): Promise<string> {
			const labelHeight = examples.length > 1 ? 30 : 0;
			const canvas = new OffscreenCanvas(width * columns, (height + labelHeight) * Math.ceil(examples.length / columns));
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
					// 描画例は黒背景へ合成して表示する。出力alphaの検証は上の数値比較で行う。
					const encoded = linearSrgbToSrgb([...pixels.subarray(index * 4, index * 4 + 4)]);
					for (let channel = 0; channel < 3; channel++) image.data[index * 4 + channel] = Math.round(encoded[channel] * 255);
					image.data[index * 4 + 3] = 255;
				}
				const x = exampleIndex % columns * width;
				const y = Math.floor(exampleIndex / columns) * (height + labelHeight);
				if (labelHeight > 0) context.fillText(example.label, x + 12, y + 21);
				context.putImageData(image, x, y + labelHeight);
			}
			return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()).toBase64();
		}
		const preview = includePreview ? await previewImage([{ label: '', params: {} }], 640, 360, 1) : null;
		const variationsPreview = includeVariationsPreview ? await previewImage([
			{ label: 'Nebula / default', params: {} },
			{ label: 'Finer structure / more coverage', params: { coverage: 0.34, noiseFrequency: 3 } },
			{ label: 'Warm palette / stronger turbulence', params: { turbulence: 2, seed: 8, ramp: { ...whiteRamp, stops: [
				{ id: 'dark', position: 0, color: [0.03, 0.001, 0.015, 1] },
				{ id: 'red', position: 0.5, color: [0.6, 0.02, 0.005, 1] },
				{ id: 'gold', position: 1, color: [1, 0.4, 0.03, 1] },
			] } } },
			{ label: 'Camera inside the cloud', params: { cameraZ: -0.8, noiseFrequency: 2.4, absorption: 2 } },
		], 400, 225, 2) : null;
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, preview, variationsPreview };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}

