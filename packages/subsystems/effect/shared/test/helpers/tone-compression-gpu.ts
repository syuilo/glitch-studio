import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { linearSrgbToOklab, oklabToLinearSrgb } from '@gs/shared/color-space.ts';
import type { LinearSrgbColor } from '@gs/shared/color-space.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/toneCompression/_def_.ts';
import implementation from '../../src/fx/toneCompression/_impl_.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type ToneCompressionParameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = LinearSrgbColor;
const scalar = (value: number) => constantShaderInput('scalar', value);
const neutral: Partial<ToneCompressionParameters> = { shadowAmount: scalar(0), highlightAmount: scalar(0) };

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
		constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value)])) as ToneCompressionParameters;
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	function texture(pixels: Color[]): ShaderInput {
		assert(pixels.length === width, 'Invalid Tone Compression test texture size');
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
		return async (overrides: Partial<ToneCompressionParameters> = {}, time = 0): Promise<number[]> => {
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
	const gray = (lightness: number): Color => [lightness ** 3, lightness ** 3, lightness ** 3, 1];
	let scopeOpen = true;
	try {
		const render = createEffect();
		const extendedColors: Color[] = [[2, -0.5, 0.125, 1], [0.5, 0.25, 0.125, 0.5], [2, 0.25, -0.5, 0], [0, 0, 0, 0]];
		const extendedPixels = Array.from({ length: width }, (_, index) => extendedColors[index % extendedColors.length]);
		// 【両Amount=0はHDR・負値・半透明を含めて完全に入力を保つ】
		// 無効化時や対象外の中間調に、色空間変換の誤差やRGBのclampが入ることを防ぐ。
		compare('zero amounts bypass', await render({ ...neutral, input: texture(extendedPixels) }), extendedPixels.flat(), 0);
		compare('negative amounts bypass', await render({ input: texture(extendedPixels), shadowAmount: scalar(-1), highlightAmount: scalar(-1) }), extendedPixels.flat(), 0);
		compare('middle gray bypass', await render({ input: inputColor([0.125, 0.125, 0.125, 1]) }), repeat([0.125, 0.125, 0.125, 1]), 0);
		const middleColor: Color = [0.125, 0.25, 0.0625, 1];
		compare('unaffected color bypass', await render({ input: inputColor(middleColor) }), repeat(middleColor), 0);
		const transparentPixels = Array.from({ length: width }, (_, index): Color => index % 2 === 0 ? [2, -0.5, 0.125, 0] : [0, 0, 0, 0]);
		compare('zero alpha and emission bypass', await render({ input: texture(transparentPixels) }), transparentPixels.flat(), 0);

		// 【既定値で完全な黒を持ち上げ、白を抑え、片側だけの無効化もできる】
		// 黒を固定する写真用カーブとの仕様の違いと、二つのAmountの独立性を確認する。
		const black = await render({ input: inputColor([0, 0, 0, 1]) });
		compare('default lifts neutral black', black, repeat(gray(0.1425)));
		compare('default compresses white', await render({ input: inputColor([1, 1, 1, 1]) }), repeat(gray(0.905)));
		compare('disabled shadows keep black', await render({ input: inputColor([0, 0, 0, 1]), shadowAmount: scalar(0) }), repeat([0, 0, 0, 1]), 0);
		compare('disabled highlights keep white', await render({ input: inputColor([1, 1, 1, 1]), highlightAmount: scalar(0) }), repeat([1, 1, 1, 1]), 0);
		let previousBlack = 0;
		let previousWhite = 1;
		for (const amount of [0.25, 0.5, 1]) {
			const lifted = await render({ ...neutral, input: inputColor([0, 0, 0, 1]), shadowAmount: scalar(amount) });
			const compressed = await render({ ...neutral, input: inputColor([1, 1, 1, 1]), highlightAmount: scalar(amount) });
			check(`independent amounts ${amount}`, lifted[0] > previousBlack && compressed[0] < previousWhite);
			previousBlack = lifted[0];
			previousWhite = compressed[0];
		}

		// 【閾値は対象範囲を動かし、Softnessは閾値の両側へ移行区間を広げる】
		// 補正量を範囲の変更と取り違えたり、Softness=0で不連続やゼロ除算が生じることを検出する。
		for (const side of ['shadow', 'highlight'] as const) {
			const amountName = `${side}Amount` as const;
			const thresholdName = `${side}Threshold` as const;
			const softnessName = `${side}Softness` as const;
			const direction = side === 'shadow' ? 1 : -1;
			const atThreshold = { ...neutral, input: inputColor(gray(0.5)), [amountName]: scalar(0.5), [thresholdName]: scalar(0.5), [softnessName]: scalar(0) };
			compare(`${side} hard knee meets identity`, await render(atThreshold), repeat(gray(0.5)), 0);
			compare(`${side} soft knee center`, await render({ ...atThreshold, [softnessName]: scalar(0.4) }), repeat(gray(0.5 + direction * 0.02375)));
			const active = await render({ ...atThreshold, [thresholdName]: scalar(0.5 + direction * 0.25) });
			check(`${side} threshold selects tones`, direction * (active[0] - 0.125) > 0);
			compare(`${side} threshold excludes tones`, await render({ ...atThreshold, [thresholdName]: scalar(0.5 - direction * 0.25) }), repeat(gray(0.5)), 0);
			compare(`${side} negative softness is hard knee`, await render({ ...atThreshold, [softnessName]: scalar(-1) }), repeat(gray(0.5)), 0);
			// 【移行区間の端で補正カーブの傾きが滑らかにつながる】
			// 出力画像の階調に折れ目が出る誤実装を、実際のfloat16出力の差分から検出する。
			for (const edge of [0.25, 0.75]) {
				const step = 1 / 64;
				const samples: number[] = [];
				for (const lightness of [edge - step, edge, edge + step]) {
					const output = await render({ ...atThreshold, input: inputColor(gray(lightness)), [amountName]: scalar(0.75), [softnessName]: scalar(0.5) });
					samples.push(Math.cbrt(output[0]));
				}
				const leftSlope = (samples[1] - samples[0]) / step;
				const rightSlope = (samples[2] - samples[1]) / step;
				const compressedEdge = side === 'shadow' ? edge === 0.25 : edge === 0.75;
				const expectedSlope = compressedEdge ? 0.2875 : 1;
				check(`${side} continuous slope at ${edge}`, Math.abs(leftSlope - rightSlope) < 0.05 && Math.abs((leftSlope + rightSlope) / 2 - expectedSlope) < 0.04);
			}
		}

		// 【最大補正や閾値の逆転でも明暗が反転せず、負値とHDRの階調差を残す】
		// 元のLへ両補正を加算すると重なった領域で傾きが負になるため、重なりを重点的に検証する。
		const ramp = Array.from({ length: width }, (_, index) => gray(-1 + index * 4 / (width - 1)));
		const rampInput = texture(ramp);
		for (const [shadowThreshold, highlightThreshold] of [[0.3, 0.8], [0.5, 0.5], [1, 0], [-0.5, 1.5]]) {
			for (const softness of [0, 0.5, 2]) {
				const output = await render({ input: rampInput, shadowAmount: scalar(1), highlightAmount: scalar(1),
					shadowThreshold: scalar(shadowThreshold), highlightThreshold: scalar(highlightThreshold), shadowSoftness: scalar(softness), highlightSoftness: scalar(softness) });
				let previous = -Infinity;
				for (let index = 0; index < width; index++) {
					const current = output[index * 4];
					assert(Number.isFinite(current) && current >= previous, `Nonmonotone tone at ${index}: ${current} < ${previous}`);
					assert(current === output[index * 4 + 1] && current === output[index * 4 + 2] && output[index * 4 + 3] === 1, 'Tone changed neutral color or alpha');
					previous = current;
				}
				check(`monotone thresholds ${shadowThreshold}/${highlightThreshold} softness ${softness}`, output[0] < output[4] && output.at(-4)! > output.at(-8)!);
			}
		}
		const hdr = await render({ input: inputColor([8, 8, 8, 1]) });
		check('retains HDR output', hdr[0] > 1 && hdr[0] < 8);
		const negative = await render({ input: inputColor([-1, -1, -1, 1]) });
		check('retains negative output', negative[0] < 0 && negative[0] > -1);
		compare('extended highlight threshold bypass', await render({ input: inputColor([8, 8, 8, 1]), highlightThreshold: scalar(3) }), repeat([8, 8, 8, 1]), 0);
		compare('negative shadow threshold bypass', await render({ input: inputColor([-0.125, -0.125, -0.125, 1]), shadowThreshold: scalar(-1) }), repeat([-0.125, -0.125, -0.125, 1]), 0);
		compare('amount upper bounds', await render({ input: rampInput, shadowAmount: scalar(2), highlightAmount: scalar(3) }), await render({ input: rampInput, shadowAmount: scalar(1), highlightAmount: scalar(1) }), 0);

		// 【重なった領域では暗部の補正後に明部を補正する】
		// 閾値を自動で並べ替えたり、実装変更で順序が逆になったりすることを検出する。
		const overlap = { shadowThreshold: scalar(0.75), highlightThreshold: scalar(0.25), shadowSoftness: scalar(0), highlightSoftness: scalar(0), shadowAmount: scalar(1), highlightAmount: scalar(1) };
		const shadowOnly = await render({ ...overlap, input: inputColor(gray(0.5)), highlightAmount: scalar(0) });
		const sequential = await render({ ...overlap, input: inputColor(shadowOnly.slice(0, 4) as Color), shadowAmount: scalar(0) });
		compare('overlap follows shadows then highlights', await render({ ...overlap, input: inputColor(gray(0.5)) }), sequential);

		// 【明度を補正してもOklabの色相・クロマと範囲外のRGBを維持する】
		// RGB成分ごとの独立した圧縮や、補正後の色域clampを誤って入れることを防ぐ。
		for (const lightness of [0.2, 0.9]) {
			const color = oklabToLinearSrgb([lightness, 0.08, -0.05, 1]);
			const adjusted = lab(await render({ input: inputColor(color) }));
			check(`preserves Oklab chroma and hue at ${lightness}`, Math.abs(adjusted[1] - 0.08) < 0.0003 && Math.abs(adjusted[2] + 0.05) < 0.0003 && Math.abs(adjusted[0] - lightness) > 0.01);
		}
		const signedOutput = await render({ input: inputColor([-0.5, 0.25, 2, 1]), highlightThreshold: scalar(0.5), highlightAmount: scalar(0.1) });
		check('preserves signed RGB', signedOutput[0] < 0 && signedOutput[2] > 1 && signedOutput.every(Number.isFinite));

		// 【半透明の黒も同じ明度まで持ち上げ、元のalphaを維持する】
		// 乗算済みの暗さを判定したり、極小alphaを透明扱いして補正を抜かす誤りを防ぐ。
		const opaque: Color = [0.015625, 0.0078125, 0.03125, 1];
		const opaqueOutput = await render({ input: inputColor(opaque) });
		for (const alpha of [0.5, 1 / 1024]) {
			compare(`premultiplied color alpha ${alpha}`, await render({ input: inputColor([opaque[0], opaque[1], opaque[2], alpha]) }), opaqueOutput.map((value, index) => index % 4 === 3 ? alpha : value * alpha));
			compare(`premultiplied black alpha ${alpha}`, await render({ input: inputColor([0, 0, 0, alpha]) }), black.map((value, index) => index % 4 === 3 ? alpha : value * alpha));
		}

		// 【六つの数値入力と画像を同時にテクスチャへ切り替えても、定数指定と一致する】
		// 隣接画素に無効化・片側補正・重なりを混在させ、分岐の内側で入力を読んでいないことも確認する。
		const parameterValues = {
			shadowThreshold: [0.25, 0.5, 0.75, -0.5], shadowSoftness: [0, 0.25, 1, 0.5], shadowAmount: [0, 0.5, 1, 0.25],
			highlightThreshold: [0.75, 0.5, 0.25, 1.5], highlightSoftness: [0.5, 1, 0.25, 0], highlightAmount: [0, 1, 0.5, 0.25],
		};
		const spatialColors: Color[] = [[0, 0, 0, 1], [0.125, 0.0625, 0.03125, 0.5], [2, -0.5, 0.125, 1], [4, 4, 4, 1]];
		const expectedPixels: number[][] = [];
		for (let index = 0; index < spatialColors.length; index++) {
			const parameters = Object.fromEntries(Object.entries(parameterValues).map(([name, values]) => [name, scalar(values[index])])) as Partial<ToneCompressionParameters>;
			// anyを使い、テクスチャと同じ乗算済みRGBAをuniformへ渡す。
			expectedPixels.push((await render({ ...parameters, input: constantShaderInput('any', spatialColors[index]) })).slice(0, 4));
		}
		const spatialParameters = Object.fromEntries(Object.entries(parameterValues).map(([name, values]) => [name,
			texture(Array.from({ length: width }, (_, index): Color => [values[index % values.length], 0, 0, 1]))])) as Partial<ToneCompressionParameters>;
		compare('all spatial parameters match uniforms', await render({ ...spatialParameters, input: texture(Array.from({ length: width }, (_, index) => spatialColors[index % spatialColors.length])) }),
			Array.from({ length: width }, (_, index) => expectedPixels[index % expectedPixels.length]).flat(), 0);

		// 【時刻・履歴・解像度・縦横比によって補正結果を変えない】
		// プレビューと動画書き出しで、再生順序や出力サイズによる見た目の差を生じさせない。
		compare('time independent', await render({ input: inputColor(opaque) }, 123), opaqueOutput, 0);
		compare('render order independent', await render({ input: inputColor(opaque) }, -10), opaqueOutput, 0);
		compare('resolution and aspect independent', await createEffect({ width: 4, height: 16 })({ input: inputColor(opaque) }), opaqueOutput, 0);
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
