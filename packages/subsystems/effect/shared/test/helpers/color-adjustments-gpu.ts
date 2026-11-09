import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { linearSrgbToOklch, oklchToLinearSrgb, srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import type { LinearSrgbColor } from '@gs/shared/color-space.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import exposureDefinition from '../../src/fx/exposure/_def_.ts';
import exposureImplementation from '../../src/fx/exposure/_impl_.ts';
import contrastDefinition from '../../src/fx/contrast/_def_.ts';
import contrastImplementation from '../../src/fx/contrast/_impl_.ts';
import rgbOffsetDefinition from '../../src/fx/rgbOffset/_def_.ts';
import rgbOffsetImplementation from '../../src/fx/rgbOffset/_impl_.ts';
import oklchAdjustDefinition from '../../src/fx/oklchAdjust/_def_.ts';
import oklchAdjustImplementation from '../../src/fx/oklchAdjust/_impl_.ts';
import type { EffectDefinition } from '../../src/effect-definition.ts';
import type { EffectImplementation } from '../../src/effect-implementation.ts';

type Color = LinearSrgbColor;
const scalar = (value: number) => constantShaderInput('scalar', value);
const premultiply = (color: Color): Color => [color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3]];

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const resolution = { width: 4, height: 1 };
	const vertex = device.createShaderModule({ code: vertexCode });
	const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });
	disposers.push(() => { copyTarget.destroy(); buffer.destroy(); });

	function texture(pixels: Color[]): ShaderInput {
		assert(pixels.length === resolution.width, 'Invalid test texture size');
		const image = device.createTexture({ size: resolution, format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: image }, new Float16Array(pixels.flat()), { bytesPerRow: resolution.width * 8 }, resolution);
		disposers.push(() => image.destroy());
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
	}
	const scalarTexture = (values: number[]) => texture(values.map(value => [value, 0, 0, 1]));

	function createEffect(definition: EffectDefinition, implementation: EffectImplementation) {
		const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
			constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value)]));
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: status => {
			if (status.type === 'error') throw new Error(status.message);
		} });
		const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposers.push(() => { instance.dispose(); output.destroy(); });
		return async (overrides: Record<string, ShaderInput> = {}): Promise<number[]> => {
			const encoder = device.createCommandEncoder();
			instance.render({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time: 0, timeDelta: 0,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: (commandEncoder, descriptor) => commandEncoder.beginComputePass(descriptor),
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow: 256 }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			try { return Array.from(new Float32Array(buffer.getMappedRange()).slice(0, resolution.width * 4)); }
			finally { buffer.unmap(); }
		};
	}

	function compare(label: string, actual: number[], colors: Color[], tolerance = 0.002) {
		const expected = colors.flat();
		assert(actual.length === expected.length, `${label}: missing output pixels`);
		actual.forEach((value, index) => {
			// alphaは以下の全ケースでfloat16に正確に収まる値。RGBの許容誤差でalphaの破損を隠さない。
			const margin = index % 4 === 3 || tolerance === 0 ? 0 : Math.max(0.000001, Math.abs(expected[index]) * tolerance);
			assert(Number.isFinite(value) && Math.abs(value - expected[index]) <= margin, `${label}: channel ${index} = ${value}, expected ${expected[index]}`);
		});
		checks.push(label);
	}
	const repeated = (color: Color) => Array.from({ length: resolution.width }, () => color);
	const oklchExpected = (color: Color, lightness: number, chroma: number, hue: number): Color => {
		const converted = linearSrgbToOklch(color);
		return premultiply(oklchToLinearSrgb([converted[0] + lightness, converted[1] * Math.max(0, chroma), converted[2] + hue * 360, color[3]]));
	};

	try {
		const exposure = createEffect(exposureDefinition, exposureImplementation);
		const contrast = createEffect(contrastDefinition, contrastImplementation);
		const rgbOffset = createEffect(rgbOffsetDefinition, rgbOffsetImplementation);
		const oklchAdjust = createEffect(oklchAdjustDefinition, oklchAdjustImplementation);
		const extendedPixels: Color[] = [[2, -0.5, 0.125, 1], [0.5, 0.25, 0.125, 0.5], [2, 0.25, -0.5, 0], [0, 0, 0, 0]];
		const extendedInput = texture(extendedPixels);
		// 【既定値はHDR・負値・半透明・発光を含む入力を変更しない】
		// 非線形変換の往復で、未調整なのに画素が変化することも防ぐ。
		for (const [name, render] of [['exposure', exposure], ['contrast', contrast], ['RGB offset', rgbOffset], ['OKLCH', oklchAdjust]] as const) {
			compare(`${name} identity`, await render({ input: extendedInput }), extendedPixels, 0);
		}

		// 【露出は符号付きの光量に作用し、alpha=0の発光も調整できる】
		// alphaを光量と一緒に乗算したり、未乗算のために発光を消す実装を検出する。
		for (const exposureValue of [-1, 1]) {
			compare(`exposure ${exposureValue} EV`, await exposure({ input: extendedInput, exposure: scalar(exposureValue) }),
				extendedPixels.map(color => [color[0] * 2 ** exposureValue, color[1] * 2 ** exposureValue, color[2] * 2 ** exposureValue, color[3]]));
		}
		const exposures = [-1, 0, 1, 2];
		compare('spatial exposure', await exposure({ input: constantShaderInput('color', [1, 0.5, -0.25, 0.5]), exposure: scalarTexture(exposures) }),
			exposures.map(value => [0.5 * 2 ** value, 0.25 * 2 ** value, -0.125 * 2 ** value, 0.5]));

		// 【コントラストはsRGBの基準値を中心に変化し、上下の色域外を保持する】
		// linearで同じ式を使う誤りや、基準値を固定したままにする誤りを検出する。
		const contrastInput = constantShaderInput('color', srgbToLinearSrgb([0.25, 0.5, 0.75, 0.5]));
		compare('contrast around default pivot', await contrast({ input: contrastInput, contrast: scalar(2) }), repeated(premultiply(srgbToLinearSrgb([0, 0.5, 1, 0.5]))));
		compare('contrast around custom pivot', await contrast({ input: contrastInput, contrast: scalar(2), pivot: scalar(0.25) }), repeated(premultiply(srgbToLinearSrgb([0.25, 0.75, 1.25, 0.5]))));
		compare('zero contrast returns pivot', await contrast({ input: contrastInput, contrast: scalar(0), pivot: scalar(0.25) }), repeated(premultiply(srgbToLinearSrgb([0.25, 0.25, 0.25, 0.5]))));
		compare('contrast keeps negative output', await contrast({ input: contrastInput, contrast: scalar(4) }), repeated(premultiply(srgbToLinearSrgb([-0.5, 0.5, 1.5, 0.5]))));
		const pivots = [0, 0.25, 0.5, 1];
		compare('spatial contrast and pivot', await contrast({ input: contrastInput, contrast: scalarTexture([0, 1, 2, 3]), pivot: scalarTexture(pivots) }),
			pivots.map((pivot, index) => premultiply(srgbToLinearSrgb([0.25, 0.5, 0.75].map(channel => (channel - pivot) * index + pivot).concat(0.5)))));

		// 【RGB Offsetは符号付きのsRGB成分へ加算し、色を未乗算で調整する】
		// linearでの加算や、半透明のRGBへの直接加算では同じ結果にならない。
		const offsetInput = constantShaderInput('color', srgbToLinearSrgb([-0.25, 0.5, 1.25, 0.5]));
		compare('RGB offset preserves extended input', await rgbOffset({ input: offsetInput, offset: scalar(0.25) }), repeated(premultiply(srgbToLinearSrgb([0, 0.75, 1.5, 0.5]))));
		compare('negative RGB offset', await rgbOffset({ input: offsetInput, offset: scalar(-0.25) }), repeated(premultiply(srgbToLinearSrgb([-0.5, 0.25, 1, 0.5]))));
		const offsets = [-0.5, -0.25, 0, 0.5];
		compare('spatial RGB offset', await rgbOffset({ input: offsetInput, offset: scalarTexture(offsets) }),
			offsets.map(value => premultiply(srgbToLinearSrgb([-0.25 + value, 0.5 + value, 1.25 + value, 0.5]))));

		// 【クロマはsRGBの境界でも増やせ、LとHを保った色域外の結果になる】
		// 通常の赤はすでにsRGBの限界なので、従来のHSL上限やRGB制限が残ると失敗する。
		const red: Color = [1, 0, 0, 0.5];
		const redInput = constantShaderInput('color', red);
		for (const chroma of [0, 2, 4, -1]) {
			compare(`OKLCH chroma ${chroma}`, await oklchAdjust({ input: redInput, chroma: scalar(chroma) }), repeated(oklchExpected(red, 0, chroma, 0)));
		}
		for (const hue of [0.125, -0.875, 1.125]) {
			compare(`OKLCH hue ${hue}`, await oklchAdjust({ input: redInput, hue: scalar(hue) }), repeated(oklchExpected(red, 0, 1, 0.125)));
		}
		compare('OKLCH full turn identity', await oklchAdjust({ input: extendedInput, hue: scalar(1) }), extendedPixels, 0);
		compare('OKLCH simultaneous adjustments', await oklchAdjust({ input: redInput, lightness: scalar(0.25), chroma: scalar(2), hue: scalar(-0.25) }), repeated(oklchExpected(red, 0.25, 2, -0.25)));
		const signedColor: Color = [-2, -0.25, 1, 0.5];
		compare('OKLCH signed LMS cube roots', await oklchAdjust({ input: constantShaderInput('color', signedColor), hue: scalar(0.25) }), repeated(oklchExpected(signedColor, 0, 1, 0.25)));

		// 【明度は上限・下限を持たず、無彩色のクロマや色相操作で色味が発生しない】
		// Lを0〜1へ制限する実装や、黒の色相計算でNaNになる実装を検出する。
		compare('OKLCH black lightness offset', await oklchAdjust({ input: constantShaderInput('color', [0, 0, 0, 1]), lightness: scalar(0.5) }), repeated([0.125, 0.125, 0.125, 1]));
		compare('OKLCH HDR lightness', await oklchAdjust({ input: constantShaderInput('color', [1, 1, 1, 1]), lightness: scalar(0.25) }), repeated([1.953125, 1.953125, 1.953125, 1]));
		compare('OKLCH negative lightness', await oklchAdjust({ input: constantShaderInput('color', [0.125, 0.125, 0.125, 1]), lightness: scalar(-1) }), repeated([-0.125, -0.125, -0.125, 1]));
		compare('OKLCH neutral hue and chroma', await oklchAdjust({ input: constantShaderInput('color', [0.125, 0.125, 0.125, 0.5]), hue: scalar(0.25), chroma: scalar(4) }), repeated([0.0625, 0.0625, 0.0625, 0.5]));
		const tinyAlpha: Color = [1, 0, 0, 1 / 1024];
		compare('OKLCH tiny alpha color', await oklchAdjust({ input: constantShaderInput('color', tinyAlpha), chroma: scalar(2) }), repeated(oklchExpected(tinyAlpha, 0, 2, 0)));
		const lightnesses = [-0.25, 0, 0.25, 0.5];
		const chromas = [0, 0.5, 1, 2];
		const hues = [-0.25, 0, 0.25, 0.5];
		compare('spatial OKLCH adjustments', await oklchAdjust({ input: redInput, lightness: scalarTexture(lightnesses), chroma: scalarTexture(chromas), hue: scalarTexture(hues) }),
			lightnesses.map((value, index) => oklchExpected(red, value, chromas[index], hues[index])));

		// 【未乗算を必要とする調整は、alpha=0の発光を変更せずに通す】
		// 0除算や、L・Offsetの加算から透明黒へ色が漏れることを防ぐ。
		const transparentPixels: Color[] = [[2, 0.25, -0.5, 0], [0, 0, 0, 0], [1, -1, 0, 0], [-2, 4, 1, 0]];
		const transparentInput = texture(transparentPixels);
		compare('contrast preserves zero alpha', await contrast({ input: transparentInput, contrast: scalar(2) }), transparentPixels, 0);
		compare('RGB offset preserves zero alpha', await rgbOffset({ input: transparentInput, offset: scalar(0.5) }), transparentPixels, 0);
		compare('OKLCH preserves zero alpha', await oklchAdjust({ input: transparentInput, lightness: scalar(0.5), chroma: scalar(2), hue: scalar(0.25) }), transparentPixels, 0);
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks };
	} finally {
		for (const dispose of disposers.toReversed()) dispose();
		device.destroy();
	}
}
