import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { linearSrgbToOklab, oklabToLinearSrgb } from '@gs/shared/color-space.ts';
import type { LinearSrgbColor } from '@gs/shared/color-space.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/softClamp/_def_.ts';
import implementation from '../../src/fx/softClamp/_impl_.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type SoftClampParameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = LinearSrgbColor;
const scalar = (value: number) => constantShaderInput('scalar', value);
const hard: Partial<SoftClampParameters> = { lowerSoftness: scalar(0), upperSoftness: scalar(0) };

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
		constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value)])) as SoftClampParameters;
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	function texture(pixels: Color[]): ShaderInput {
		assert(pixels.length === width, 'Invalid Soft Clamp test texture size');
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
		return async (overrides: Partial<SoftClampParameters> = {}, time = 0): Promise<number[]> => {
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
		const limits = { lowerLimit: scalar(0.25), upperLimit: scalar(0.75) };
		// 【既定値で黒と白を上下限へ収め、対象外の中間調はそのまま返す】
		// 圧縮量だけを変える処理との違いと、中間調への変換誤差の混入を検証する。
		const black = await render({ input: inputColor([0, 0, 0, 1]) });
		compare('default lifts black to lower limit', black, repeat(gray(0.1)));
		compare('default limits white', await render({ input: inputColor([1, 1, 1, 1]) }), repeat(gray(0.9)));
		const middleColor: Color = [0.125, 0.25, 0.0625, 1];
		compare('unaffected color bypass', await render({ input: inputColor(middleColor) }), repeat(middleColor), 0);
		compare('middle gray bypass', await render({ input: inputColor(gray(0.5)) }), repeat(gray(0.5)), 0);
		const transparentPixels = Array.from({ length: width }, (_, index): Color => index % 2 === 0 ? [2, -0.5, 0.125, 0] : [0, 0, 0, 0]);
		compare('zero alpha and emission bypass', await render({ input: texture(transparentPixels) }), transparentPixels.flat(), 0);

		// 【Softness=0では明度の通常のclampとなり、負値とHDRも設定範囲へ制限する】
		// 端で傾きを残したり、明度ではなくRGB各成分をclampする誤りを防ぐ。
		for (const lightness of [-2, 0, 0.25, 0.5, 0.75, 1, 4]) {
			compare(`hard clamp lightness ${lightness}`, await render({ ...hard, ...limits, input: inputColor(gray(lightness)) }), repeat(gray(Math.max(0.25, Math.min(0.75, lightness)))));
		}
		const ramp = Array.from({ length: width }, (_, index) => gray(-1 + index * 4 / (width - 1)));
		const rampInput = texture(ramp);
		compare('negative softness is hard clamp', await render({ ...limits, input: rampInput, lowerSoftness: scalar(-1), upperSoftness: scalar(-2) }), await render({ ...hard, ...limits, input: rampInput }), 0);

		// 【移行区間の中心と両端が、独立した上下のSoftnessに従う】
		// 幅の意味が半幅へ変わったり、片側のSoftnessが反対側へ漏れたりすることを検出する。
		const soft = { ...limits, lowerSoftness: scalar(0.25), upperSoftness: scalar(0.25) };
		compare('lower knee center', await render({ ...soft, input: inputColor(gray(0.25)) }), repeat(gray(0.28125)));
		compare('upper knee center', await render({ ...soft, input: inputColor(gray(0.75)) }), repeat(gray(0.71875)));
		compare('lower knee interior', await render({ ...soft, input: inputColor(gray(0.1875)) }), repeat(gray(0.2578125)));
		compare('upper knee interior', await render({ ...soft, input: inputColor(gray(0.8125)) }), repeat(gray(0.7421875)));
		compare('lower softness leaves upper knee', await render({ ...soft, input: inputColor(gray(0.75)), lowerSoftness: scalar(0) }), await render({ ...soft, input: inputColor(gray(0.75)) }), 0);
		compare('upper softness leaves lower knee', await render({ ...soft, input: inputColor(gray(0.25)), upperSoftness: scalar(0) }), await render({ ...soft, input: inputColor(gray(0.25)) }), 0);
		// 【なだらかな境界では平坦部・恒等写像との接続点で傾きも連続する】
		// サンプルの差分から傾きを調べ、見た目の帯や折れ目を生む接続の誤りを検出する。
		for (const [edge, expectedSlope] of [[0.125, 0], [0.375, 1], [0.625, 1], [0.875, 0]]) {
			const step = 1 / 128;
			const samples: number[] = [];
			for (const lightness of [edge - step, edge, edge + step]) {
				const output = await render({ ...soft, input: inputColor(gray(lightness)) });
				samples.push(Math.cbrt(output[0]));
			}
			const leftSlope = (samples[1] - samples[0]) / step;
			const rightSlope = (samples[2] - samples[1]) / step;
			check(`continuous slope at ${edge}`, Math.abs(leftSlope - rightSlope) < 0.07 && Math.abs((leftSlope + rightSlope) / 2 - expectedSlope) < 0.05);
		}

		// 【幅が重なる設定や片側だけ極端に広い設定でも、単調性と上下限を守る】
		// 下側・上側のsmooth max/minを単純に重ねるだけでは、幅の非対称性で範囲外へ出る場合がある。
		for (const [lowerSoftness, upperSoftness] of [[0, 0], [0.25, 0.25], [1, 1], [8, 2], [0, 4], [4, 0], [0.01, 10]]) {
			const output = await render({ ...limits, input: rampInput, lowerSoftness: scalar(lowerSoftness), upperSoftness: scalar(upperSoftness) });
			let previous = -Infinity;
			for (let index = 0; index < width; index++) {
				const current = output[index * 4];
				assert(Number.isFinite(current) && current >= previous, `Nonmonotone tone at ${index}: ${current} < ${previous}`);
				assert(current >= 0.25 ** 3 - 0.00001 && current <= 0.75 ** 3 + 0.0003, `Output outside limits at ${index}: ${current}`);
				assert(current === output[index * 4 + 1] && current === output[index * 4 + 2] && output[index * 4 + 3] === 1, 'Soft Clamp changed neutral color or alpha');
				previous = current;
			}
			check(`bounded monotone softness ${lowerSoftness}/${upperSoftness}`, output[0] === output[4] && output.at(-4) === output.at(-8) && output[0] < output.at(-4)!);
		}
		compare('overlapping widths preserve ratio', await render({ ...limits, input: rampInput, lowerSoftness: scalar(8), upperSoftness: scalar(2) }),
			await render({ ...limits, input: rampInput, lowerSoftness: scalar(0.8), upperSoftness: scalar(0.2) }));
		compare('overlapping knees meet identity', await render({ ...limits, input: inputColor(gray(0.5)), lowerSoftness: scalar(1), upperSoftness: scalar(1) }), repeat(gray(0.5)), 0);

		// 【上下限の逆転・一致・狭い範囲でも有限な出力を返す】
		// アニメーションやノードの場で上下限が交差した際、NaNや明暗の反転を起こさないようにする。
		compare('reversed limits retain softness roles', await render({ input: rampInput, lowerLimit: scalar(0.75), upperLimit: scalar(0.25), lowerSoftness: scalar(0.25), upperSoftness: scalar(0.5) }),
			await render({ input: rampInput, ...limits, lowerSoftness: scalar(0.25), upperSoftness: scalar(0.5) }), 0);
		for (const limit of [-0.5, 0, 0.5, 2]) {
			compare(`equal limits ${limit}`, await render({ input: rampInput, lowerLimit: scalar(limit), upperLimit: scalar(limit), lowerSoftness: scalar(4), upperSoftness: scalar(1) }), repeat(gray(limit)));
		}
		const narrow = await render({ input: rampInput, lowerLimit: scalar(0.5), upperLimit: scalar(0.5001), lowerSoftness: scalar(4), upperSoftness: scalar(1) });
		check('narrow limits remain finite and bounded', narrow.every(Number.isFinite) && narrow.filter((_, index) => index % 4 !== 3).every(value => value >= 0.125 && value <= 0.1252));

		// 【上下限自体は0〜1に制限せず、設定に応じて負値やHDRの出力を許す】
		// Soft ClampをSDR色域制限と取り違え、ユーザーが指定した範囲を狭めないことを検証する。
		const extendedLimits = { lowerLimit: scalar(-0.5), upperLimit: scalar(2) };
		compare('negative lower limit', await render({ ...extendedLimits, input: inputColor(gray(-2)) }), repeat(gray(-0.5)));
		compare('HDR upper limit', await render({ ...extendedLimits, input: inputColor(gray(4)) }), repeat(gray(2)));
		const signedColor: Color = [-0.5, 0.25, 2, 1];
		compare('extended unaffected color bypass', await render({ ...extendedLimits, input: inputColor(signedColor) }), repeat(signedColor), 0);
		// 【色相・クロマを保持し、明度を制限してもRGBの成分は個別に切り詰めない】
		// 画像を単に彩度の低い色へ変換したり、色域外成分を削除する誤りを検出する。
		for (const lightness of [0.1, 0.9]) {
			const color = oklabToLinearSrgb([lightness, 0.08, -0.05, 1]);
			const adjusted = lab(await render({ ...hard, ...limits, input: inputColor(color) }));
			const expectedLightness = lightness < 0.25 ? 0.25 : 0.75;
			check(`preserves Oklab chroma and hue at ${lightness}`, Math.abs(adjusted[0] - expectedLightness) < 0.0003 && Math.abs(adjusted[1] - 0.08) < 0.0003 && Math.abs(adjusted[2] + 0.05) < 0.0003);
		}
		const signedOutput = await render({ ...hard, lowerLimit: scalar(0.7), upperLimit: scalar(0.7), input: inputColor(signedColor) });
		check('lightness limits do not clip RGB', signedOutput[0] < 0 && signedOutput[2] > 1 && signedOutput.every(Number.isFinite));

		// 【半透明でも未乗算の明度に同じ上下限を適用し、alphaを維持する】
		// 黒の持ち上げが透明度へ漏れたり、乗算済みの暗さによって補正範囲が変わったりすることを防ぐ。
		const opaque: Color = [0.75, 0.25, 0.125, 1];
		const opaqueOutput = await render({ ...limits, input: inputColor(opaque) });
		for (const alpha of [0.5, 1 / 1024]) {
			compare(`premultiplied color alpha ${alpha}`, await render({ ...limits, input: inputColor([opaque[0], opaque[1], opaque[2], alpha]) }), opaqueOutput.map((value, index) => index % 4 === 3 ? alpha : value * alpha));
			compare(`premultiplied black alpha ${alpha}`, await render({ input: inputColor([0, 0, 0, alpha]) }), black.map((value, index) => index % 4 === 3 ? alpha : value * alpha));
		}

		// 【全パラメータを画素ごとに変えても、定数入力と一致する】
		// 対象外・上下限の一致・逆転・幅の重なりを隣接させ、全入力を分岐前に読む必要性も検証する。
		const parameterValues = {
			lowerLimit: [0.25, 0.5, 0.75, -0.5], upperLimit: [0.75, 0.5, 0.25, 1.5],
			lowerSoftness: [0, 0.25, 1, 0.5], upperSoftness: [0.5, 1, 0.25, 0],
		};
		const spatialColors: Color[] = [gray(0.5), [0.125, 0.0625, 0.03125, 0.5], [2, -0.5, 0.125, 1], [4, 4, 4, 1]];
		const expectedPixels: number[][] = [];
		for (let index = 0; index < spatialColors.length; index++) {
			const parameters = Object.fromEntries(Object.entries(parameterValues).map(([name, values]) => [name, scalar(values[index])])) as Partial<SoftClampParameters>;
			// anyで乗算済みRGBAをuniformへ渡し、テクスチャとの二重乗算の差を避ける。
			expectedPixels.push((await render({ ...parameters, input: constantShaderInput('any', spatialColors[index]) })).slice(0, 4));
		}
		const spatialParameters = Object.fromEntries(Object.entries(parameterValues).map(([name, values]) => [name,
			texture(Array.from({ length: width }, (_, index): Color => [values[index % values.length], 0, 0, 1]))])) as Partial<SoftClampParameters>;
		compare('all spatial parameters match uniforms', await render({ ...spatialParameters, input: texture(Array.from({ length: width }, (_, index) => spatialColors[index % spatialColors.length])) }),
			Array.from({ length: width }, (_, index) => expectedPixels[index % expectedPixels.length]).flat(), 0);

		// 【時刻・履歴・解像度・アスペクト比を変更しても同じ色となる】
		// 書き出しサイズやフレーム順序によって補正結果が変わらないことを確認する。
		compare('time independent', await render({ ...limits, input: inputColor(opaque) }, 123), opaqueOutput, 0);
		compare('render order independent', await render({ ...limits, input: inputColor(opaque) }, -10), opaqueOutput, 0);
		compare('resolution and aspect independent', await createEffect({ width: 4, height: 16 })({ ...limits, input: inputColor(opaque) }), opaqueOutput, 0);
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
