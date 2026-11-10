import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { linearSrgbToOklab, oklabToLinearSrgb, srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import type { LinearSrgbColor } from '@gs/shared/color-space.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/filmColor/_def_.ts';
import implementation from '../../src/fx/filmColor/_impl_.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type FilmColorParameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = LinearSrgbColor;
const scalar = (value: number) => constantShaderInput('scalar', value);
const neutral: Partial<FilmColorParameters> = {
	contrast: scalar(1), shadowSoftness: scalar(0), highlightSoftness: scalar(0), fade: scalar(0),
	chromaCompression: scalar(0), shadowTintAmount: scalar(0), highlightTintAmount: scalar(0),
};

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const check = (label: string, condition: boolean) => { assert(condition, label); checks.push(label); };
	const width = 64;
	const repeat = (color: Color) => Array.from({ length: width }, () => color).flat();
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
		constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value)])) as FilmColorParameters;
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	function texture(pixels: Color[]): ShaderInput {
		assert(pixels.length === width, 'Invalid Film Color test texture size');
		const image = device.createTexture({ size: [width, 1], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: image }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, 1]);
		disposers.push(() => image.destroy());
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
	}

	function createEffect(resolution = { width, height: 1 }) {
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: status => {
			if (status.type === 'error') throw new Error(status.message);
		} });
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(resolution.width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * resolution.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposers.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<FilmColorParameters> = {}, time = 0): Promise<number[]> => {
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time * 1000,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: (commandEncoder, descriptor) => commandEncoder.beginComputePass(descriptor),
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			try {
				const data = new Float32Array(buffer.getMappedRange());
				const result: number[] = [];
				for (let row = 0; row < resolution.height; row++) result.push(...data.slice(row * bytesPerRow / 4, row * bytesPerRow / 4 + resolution.width * 4));
				return result;
			} finally { buffer.unmap(); }
		};
	}

	function compare(label: string, actual: number[], expected: number[], tolerance = 0.003) {
		assert(actual.length === expected.length, `${label}: missing output pixels`);
		actual.forEach((value, index) => {
			const margin = index % 4 === 3 || tolerance === 0 ? 0 : Math.max(0.000002, Math.abs(expected[index]) * tolerance);
			assert(Number.isFinite(value) && Math.abs(value - expected[index]) <= margin, `${label}: channel ${index} = ${value}, expected ${expected[index]}`);
		});
		checks.push(label);
	}
	const lab = (pixels: number[], index = 0) => linearSrgbToOklab(pixels.slice(index * 4, index * 4 + 4));
	const inputColor = (color: Color) => constantShaderInput('color', color);
	let scopeOpen = true;
	try {
		const render = createEffect();
		const extendedColors: Color[] = [[2, -0.5, 0.125, 1], [0.5, 0.25, 0.125, 0.5], [2, 0.25, -0.5, 0], [0, 0, 0, 0]];
		const extendedPixels = Array.from({ length: width }, (_, index) => extendedColors[index % extendedColors.length]);
		const extendedInput = texture(extendedPixels);
		// 【Amount=0と中立設定は、HDR・負値・半透明・発光を含む画素を完全に保つ】
		// 単なる見た目の一致ではなく、非線形変換の往復誤差もないことを確認する。
		compare('zero amount bypass', await render({ input: extendedInput, amount: scalar(0) }), extendedPixels.flat(), 0);
		compare('neutral settings bypass', await render({ ...neutral, input: extendedInput }), extendedPixels.flat(), 0);
		const transparentPixels = Array.from({ length: width }, (_, index): Color => index % 2 === 0 ? [2, -0.5, 0.125, 0] : [0, 0, 0, 0]);
		compare('zero alpha emission bypass', await render({ input: texture(transparentPixels), fade: scalar(1) }), transparentPixels.flat(), 0);

		// 【半透明は未乗算の色に同じ変換を行い、元のalphaへ戻す】
		// 極小alphaを透明扱いする誤りや、Fadeから不透明度が漏れる誤りを防ぐ。
		const opaque: Color = [0.75, 0.25, 0.125, 1];
		const opaqueOutput = await render({ input: inputColor(opaque), fade: scalar(0.2) });
		for (const alpha of [0.5, 1 / 1024]) {
			const actual = await render({ input: inputColor([opaque[0], opaque[1], opaque[2], alpha]), fade: scalar(0.2) });
			compare(`premultiplied alpha ${alpha}`, actual, opaqueOutput.map((value, index) => index % 4 === 3 ? alpha : value * alpha));
		}

		// 【Amountはlinear RGB上の混合であり、alphaや非線形の色成分を混合しない】
		// 途中の見た目が適用量に対して不自然に変化することを防ぐ。
		const full = await render({ input: inputColor(opaque) });
		for (const amount of [0.25, 0.5, 0.75]) {
			compare(`linear amount ${amount}`, await render({ input: inputColor(opaque), amount: scalar(amount) }),
				full.map((value, index) => index % 4 === 3 ? 1 : opaque[index % 4] * (1 - amount) + value * amount));
		}

		// 【階調は最大SoftnessやUI外のContrastでも単調性を保ち、負値・HDRの差を残す】
		// 見た目を調整する途中で明暗が反転したり、範囲外が一定値へ潰れることを検出する。
		const ramp = Array.from({ length: width }, (_, index): Color => {
			const lightness = -0.5 + index * 2.5 / (width - 1);
			return [lightness ** 3, lightness ** 3, lightness ** 3, 1];
		});
		const rampInput = texture(ramp);
		for (const contrast of [0.1, 0.5, 1, 2, 4]) {
			for (const softness of [0, 0.5, 1]) {
				const output = await render({ ...neutral, input: rampInput, contrast: scalar(contrast), shadowSoftness: scalar(softness), highlightSoftness: scalar(softness) });
				let previous = -Infinity;
				for (let index = 0; index < width; index++) {
					const current = output[index * 4];
					assert(Number.isFinite(current) && current >= previous, `Nonmonotone tone at ${index}: ${current} < ${previous}`);
					assert(Math.abs(current - output[index * 4 + 1]) < 0.001 && Math.abs(current - output[index * 4 + 2]) < 0.001, 'Tone tinted a neutral input');
					previous = current;
				}
				check(`monotone contrast ${contrast} softness ${softness}`, output[0] < 0 && output.at(-4)! > output.at(-8)!);
			}
		}
		compare('tone preserves middle gray', await render({ ...neutral, input: inputColor([0.18, 0.18, 0.18, 1]), contrast: scalar(2), shadowSoftness: scalar(1), highlightSoftness: scalar(1) }), repeat([0.18, 0.18, 0.18, 1]));
		compare('soft shadows keep black', await render({ ...neutral, input: inputColor([0, 0, 0, 1]), shadowSoftness: scalar(1) }), repeat([0, 0, 0, 1]), 0);
		compare('default keeps black', await render({ input: inputColor([0, 0, 0, 1]) }), repeat([0, 0, 0, 1]), 0);
		const dark = await render({ ...neutral, input: inputColor([0.001, 0.001, 0.001, 1]), shadowSoftness: scalar(1) });
		check('soft shadows reduce dark slope', dark[0] > 0 && dark[0] < 0.001);
		const fadedBlack = await render({ ...neutral, input: inputColor([0, 0, 0, 1]), fade: scalar(1) });
		compare('fade lifts neutral black', fadedBlack, repeat([0.015625, 0.015625, 0.015625, 1]));
		const white = await render({ ...neutral, input: inputColor([1, 1, 1, 1]), highlightSoftness: scalar(1) });
		check('soft highlights reduce white', white[0] > 0 && white[0] < 1);
		const hdr = await render({ ...neutral, input: inputColor([8, 8, 8, 1]), highlightSoftness: scalar(0.35) });
		check('soft highlights retain HDR', hdr[0] > 1 && hdr[0] < 8);

		// 【色の処理はLと色相を保って高彩度部を圧縮し、弱い色味を消さない】
		// 彩度をRGBのclampで抑えたり、無彩色判定で微弱な色を切り捨てる誤りを検出する。
		for (const chroma of [0.02, 0.2, 0.4]) {
			const color = oklabToLinearSrgb([0.65, chroma * Math.cos(0.7), chroma * Math.sin(0.7), 1]);
			const converted = lab(await render({ ...neutral, input: inputColor(color), chromaCompression: scalar(1) }));
			const resultingChroma = Math.hypot(converted[1], converted[2]);
			check(`chroma compression ${chroma}`, Math.abs(converted[0] - 0.65) < 0.001 && Math.abs(Math.atan2(converted[2], converted[1]) - 0.7) < 0.004
				&& (chroma < 0.05 ? Math.abs(resultingChroma - chroma) < 0.0002 : resultingChroma > 0.05 && resultingChroma < chroma));
		}
		const signedColor: Color = [-0.5, 0.25, 2, 1];
		const signedOutput = await render({ ...neutral, input: inputColor(signedColor), shadowTintAmount: scalar(0.1) });
		check('color processing retains signed RGB', signedOutput[0] < 0 && signedOutput[2] > 1 && signedOutput.every(Number.isFinite));
		const toneColor = oklabToLinearSrgb([0.65, 0.08, -0.05, 1]);
		const toneColorOutput = lab(await render({ ...neutral, input: inputColor(toneColor), contrast: scalar(2), shadowSoftness: scalar(0.8), highlightSoftness: scalar(0.8) }));
		check('tone preserves Oklab chroma and hue', Math.abs(toneColorOutput[1] - 0.08) < 0.0003 && Math.abs(toneColorOutput[2] + 0.05) < 0.0003);

		// 【色付けの重みは元の明度で決まり、色相は負値や複数周でも循環する】
		// Contrast/Fadeの変更で色付けの領域が動いたり、中間グレーへ色が漏れることを防ぐ。
		for (const gray of [0.027, 0.512]) {
			const input = inputColor([gray, gray, gray, 1]);
			const tint = { ...neutral, input, shadowTintAmount: scalar(0.75), highlightTintAmount: scalar(0.75) };
			const before = lab(await render(tint));
			const after = lab(await render({ ...tint, contrast: scalar(1.5), shadowSoftness: scalar(0.5), highlightSoftness: scalar(0.5), fade: scalar(0.5) }));
			check(`tint uses original lightness ${gray}`, Math.abs(before[1] - after[1]) < 0.0003 && Math.abs(before[2] - after[2]) < 0.0003);
		}
		for (const [gray, tintAmount, hue] of [[0.027, 'shadowTintAmount', 'shadowHue'], [1, 'highlightTintAmount', 'highlightHue']] as const) {
			const overrides = { ...neutral, input: inputColor([gray, gray, gray, 1]), [tintAmount]: scalar(1) };
			const reference = await render({ ...overrides, [hue]: scalar(0.125) });
			for (const wrapped of [-0.875, 1.125]) compare(`${hue} wraps ${wrapped}`, await render({ ...overrides, [hue]: scalar(wrapped) }), reference, 0);
			const tintColor = lab(reference);
			check(`${hue} matches direction`, tintColor[1] > 0 && Math.abs(tintColor[1] - tintColor[2]) < 0.0003);
		}
		const middleTint = lab(await render({ ...neutral, input: inputColor([0.18, 0.18, 0.18, 1]), shadowTintAmount: scalar(1), highlightTintAmount: scalar(1) }));
		check('tints leave middle gray neutral', Math.hypot(middleTint[1], middleTint[2]) < 0.0002);

		// 【全ノード入力が同時に空間変化しても、各画素は同じ定数指定と一致する】
		// バイパスの分岐が混在する2x2画素群でもimplicit derivativeが有効であることを確認する。
		const numericDefaults = Object.fromEntries(Object.entries(definition.paramDefs).filter(([name]) => name !== 'input').map(([name, parameter]) => [name, parameter.defaultValue.value])) as Record<Exclude<keyof FilmColorParameters, 'input'>, number>;
		const neutralValues = { contrast: 1, shadowSoftness: 0, highlightSoftness: 0, fade: 0, chromaCompression: 0, shadowTintAmount: 0, highlightTintAmount: 0 };
		const cases = [
			{ ...numericDefaults, amount: 0 }, { ...numericDefaults, ...neutralValues }, numericDefaults,
			{ ...numericDefaults, amount: 0.5, contrast: 2, fade: 0.5, chromaCompression: 1, shadowTintAmount: 1, highlightTintAmount: 1, shadowHue: -0.875, highlightHue: 1.125 },
		].map(values => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, new Float16Array([value])[0]])) as typeof numericDefaults);
		const spatial = Object.fromEntries(Object.keys(numericDefaults).map(key => [key, texture(Array.from({ length: width }, (_, index): Color => [cases[index % cases.length][key as keyof typeof numericDefaults], 0, 0, 1]))])) as Partial<FilmColorParameters>;
		const spatialPixels = Array.from({ length: width }, (): Color => [0.5, 0.25, 0.125, 0.5]);
		const referencePixels: number[][] = [];
		for (const values of cases) referencePixels.push(await render({ input: inputColor([1, 0.5, 0.25, 0.5]), ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, scalar(value)])) }));
		compare('all spatial parameters', await render({ ...spatial, input: texture(spatialPixels) }), Array.from({ length: width }, (_, index) => referencePixels[index % cases.length].slice(0, 4)).flat());

		// 【パラメータの範囲制限は操作量だけに作用し、画像のRGBには作用しない】
		// 式からUI範囲外が来ても曲線が折り返したり、ゼロ除算したりしないことを確認する。
		const limited = { contrast: scalar(0.1), shadowSoftness: scalar(0), highlightSoftness: scalar(1), fade: scalar(0), chromaCompression: scalar(1), shadowTintAmount: scalar(0), highlightTintAmount: scalar(1), amount: scalar(1) };
		const outside = { contrast: scalar(-1), shadowSoftness: scalar(-1), highlightSoftness: scalar(2), fade: scalar(-1), chromaCompression: scalar(2), shadowTintAmount: scalar(-1), highlightTintAmount: scalar(2), amount: scalar(2) };
		compare('parameter bounds', await render({ input: inputColor(opaque), ...outside }), await render({ input: inputColor(opaque), ...limited }), 0);
		compare('negative amount bypass', await render({ input: extendedInput, amount: scalar(-1) }), extendedPixels.flat(), 0);

		// 【描画時刻・履歴・解像度・アスペクト比によって色が変化しない】
		// 動画書き出しやプレビュー倍率の変更でも同じ見た目となることを確認する。
		compare('time independent', await render({ input: inputColor(opaque) }, 123), full, 0);
		compare('render order independent', await render({ input: inputColor(opaque) }, -10), full, 0);
		const portrait = createEffect({ width: 4, height: 16 });
		compare('resolution and aspect independent', await portrait({ input: inputColor(opaque) }), full, 0);
		// 【通常の写真に含まれる色と無彩色で、既定値の出力が有限となる】
		// 輝度や彩度の違う素材で初期設定が何も変えない状態になっていないことも確認する。
		const swatches: Color[] = [[0.7, 0.45, 0.35, 1], [0.95, 0.75, 0.65, 1], [0.3, 0.6, 0.9, 1], [0.2, 0.5, 0.15, 1], [0.02, 0.025, 0.04, 1], [1, 1, 1, 1]];
		for (const [index, swatch] of swatches.entries()) {
			const input = srgbToLinearSrgb(swatch);
			const output = await render({ input: inputColor(input) });
			check(`default photographic swatch ${index}`, output.every(Number.isFinite) && output[3] === 1 && output.slice(0, 3).some((value, channel) => Math.abs(value - input[channel]) > 0.0001));
		}
		const error = await device.popErrorScope();
		scopeOpen = false;
		if (error != null) throw new Error(error.message);
		return { checks };
	} catch (error) {
		if (scopeOpen) {
			const validationError = await device.popErrorScope();
			if (validationError != null) throw new Error(validationError.message);
		}
		throw error;
	} finally {
		for (const dispose of disposers.toReversed()) dispose();
		device.destroy();
	}
}
