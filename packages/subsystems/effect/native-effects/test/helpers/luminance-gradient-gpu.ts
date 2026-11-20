import { nativeEffectProbe } from './native-effect-probe.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';
import definition from '../../src/fx/luminanceGradient/_def_.ts';
import implementationNative from '../../src/fx/luminanceGradient/_impl_.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
		'canNode' in parameter && parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const sampling: ShaderInputSampling = { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' };
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	function createEffect(width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const output = implementation.createTexture('output', { wgpu, resolution });
		assert(output.format === (precise ? 'rg32float' : 'rg16float'), 'Vector output format must follow data precision');
		const instance = implementation.place(wgpu, resolution);
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposers.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0): Promise<number[]> => {
			const commandEncoder = device.createCommandEncoder();
			const createPassEncoderFor = (encoder: GPUCommandEncoder, view: GPUTextureView) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] });
			await instance.draw({ commandEncoder, time, timeDelta: time * 1000, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				params: { ...defaults, ...overrides },
				outputs: { output },
			});
			const pass = createPassEncoderFor(commandEncoder, target.createView());
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			commandEncoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			try {
				const data = new Float32Array(buffer.getMappedRange());
				const pixels: number[] = [];
				for (let row = 0; row < height; row++) pixels.push(...data.slice(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4));
				return pixels;
			} finally { buffer.unmap(); }
		};
	}

	function texture(width: number, height: number, pixelAt: (x: number, y: number) => number[]) {
		const image = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const data = new Float16Array(Array.from({ length: width * height }, (_, index) => pixelAt(index % width, Math.floor(index / width))).flat());
		device.queue.writeTexture({ texture: image }, data, { bytesPerRow: width * 8 }, [width, height]);
		disposers.push(() => image.destroy());
		return image;
	}
	const gray = (value: number, alpha = 1) => [value * alpha, value * alpha, value * alpha, alpha];
	const vectorAt = (pixels: number[], width: number, x: number, y: number) => pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 2);
	function near(label: string, actual: number[], expected: number[], tolerance = 0.015) {
		assert(actual.length === expected.length, `${label}: size mismatch`);
		actual.forEach((value, index) => assert(Number.isFinite(value) && Math.abs(value - expected[index]) <= tolerance,
			`${label}: component ${index} = ${value}, expected ${expected[index]}`));
		checks.push(label);
	}
	function zero(label: string, pixels: number[]) {
		near(label, pixels.filter((_, index) => index % 4 < 2), Array(pixels.length / 2).fill(0), 0);
	}
	try {
		for (const precise of supports32bit ? [false, true] : [false]) {
			const precision = precise ? '32bit' : '16bit';
			const render = createEffect(32, 32, precise);
			// 【空間的に一定な色は、明るさ・透明度・正規化によらず勾配0になる】
			// 定数を有限サイズの画像へ置き換えると、存在しない透明境界が勾配を作ってしまう。
			zero(`${precision} default input`, await render());
			for (const alphaMode of ['include', 'ignore'] as const) {
				zero(`${precision} constant ${alphaMode}`, await render({ input: constantShaderInput('color', [4, -2, 1, 0.25]), normalize: true, alphaMode }));
				zero(`${precision} transparent ${alphaMode}`, await render({ input: constantShaderInput('color', [4, 1, 2, 0]), alphaMode }));
			}
			const constantTexture = textureShaderInput(texture(17, 11, () => gray(0.5)), sampling);
			zero(`${precision} uniform texture with smoothing`, await render({ input: constantTexture, blurRadius: 0.08, normalize: true }));

			// 【同じ共通座標の傾斜は、解像度・縦横比によらず同じベクトルになる】
			// 負値・HDRを含む一次関数を使い、Y反転・画素数による倍率・不要なclampを検出する。
			for (const [width, height] of [[16, 16], [32, 16], [16, 32], [64, 32]]) {
				const longSide = Math.max(width, height);
				const ramp = textureShaderInput(texture(width, height, (x, y) => gray(2 * ((x + 0.5 - width / 2) / longSide) + 4 * ((height / 2 - y - 0.5) / longSide))), sampling);
				const renderRamp = createEffect(width, height, precise);
				for (const blurRadius of [0, 0.01]) {
					near(`${precision} common slope ${width}x${height} blur ${blurRadius}`, vectorAt(await renderRamp({ input: ramp, blurRadius }), width, width / 2, height / 2), [2, 4]);
				}
				near(`${precision} normalized slope ${width}x${height}`, vectorAt(await renderRamp({ input: ramp, normalize: true, strength: -2 }), width, width / 2, height / 2), [-2 / Math.sqrt(5), -4 / Math.sqrt(5)], 0.002);
			}

			// 【輝度の係数を使い、RGBの平均やsRGB表示値を微分しない】
			// グレースケールだけでは見つからない、色空間やチャンネル重みの取り違えを検出する。
			for (const [channel, coefficient] of [0.2126, 0.7152, 0.0722].entries()) {
				const input = textureShaderInput(texture(32, 32, x => { const color = [0, 0, 0, 1]; color[channel] = x / 32; return color; }), sampling);
				near(`${precision} luminance channel ${channel}`, vectorAt(await render({ input, blurRadius: 0 }), 32, 16, 16), [coefficient, 0]);
			}

			// 【透明度の変化を含むモードと除くモードを区別する】
			// 未乗算への変換を忘れたり、勾配へalphaを二重に掛けたりしないことを確認する。
			const opacityRamp = textureShaderInput(texture(32, 32, x => gray(2, (x + 1) / 32)), sampling);
			near(`${precision} includes opacity slope`, vectorAt(await render({ input: opacityRamp, blurRadius: 0 }), 32, 16, 16), [2, 0]);
			zero(`${precision} ignores opacity slope`, await render({ input: opacityRamp, alphaMode: 'ignore' }));
			const translucentRamp = textureShaderInput(texture(32, 32, x => gray(x / 32, 0.25)), sampling);
			near(`${precision} premultiplied slope`, vectorAt(await render({ input: translucentRamp, blurRadius: 0 }), 32, 16, 16), [0.25, 0]);
			near(`${precision} unpremultiplied slope`, vectorAt(await render({ input: translucentRamp, blurRadius: 0, alphaMode: 'ignore' }), 32, 16, 16), [1, 0]);
			const emission = textureShaderInput(texture(32, 32, x => [x / 32, x / 32, x / 32, 0]), sampling);
			near(`${precision} includes zero-alpha emission`, vectorAt(await render({ input: emission, blurRadius: 0 }), 32, 16, 16), [1, 0]);
			zero(`${precision} ignores zero-alpha emission`, await render({ input: emission, alphaMode: 'ignore' }));

			// 【ぼかしは急な境界の勾配を弱め、周囲へ広げる】
			// 方向やStrengthを変えるだけの実装を除外し、半径・Size Referenceの効果を検証する。
			const edge = textureShaderInput(texture(32, 32, x => gray(x < 16 ? 0 : 1)), sampling);
			const sharp = await render({ input: edge, blurRadius: 0 });
			const smooth = await render({ input: edge, blurRadius: 0.05 });
			assert(vectorAt(sharp, 32, 15, 16)[0] > vectorAt(smooth, 32, 15, 16)[0], 'Smoothing must reduce the peak slope');
			assert(vectorAt(smooth, 32, 12, 16)[0] > 0.1 && vectorAt(sharp, 32, 12, 16)[0] === 0, 'Smoothing must spread the edge');
			checks.push(`${precision} Gaussian smoothing spreads edges`);
			// 【縦方向も同じ範囲でぼかし、画像の上下とベクトルのY方向を区別する】
			// 一次関数の勾配はぼかしても変わらないため、段差の転置で垂直パスの欠落を検出する。
			const verticalEdge = textureShaderInput(texture(32, 32, (_x, y) => gray(y < 16 ? 0 : 1)), sampling);
			const verticalSmooth = await render({ input: verticalEdge, blurRadius: 0.05 });
			near(`${precision} symmetric horizontal and vertical smoothing`,
				Array.from({ length: 32 }, (_, index) => vectorAt(verticalSmooth, 32, 16, index)[1]),
				Array.from({ length: 32 }, (_, index) => -vectorAt(smooth, 32, index, 16)[0]), 0.02);

			// 【ガウスぼかしは正弦波の振幅を既知の割合へ減衰させる】
			// シェーダーと同じループを複製せず、連続ガウス分布の周波数応答でsigmaの意味を検証する。
			// ±3sigmaへの打ち切り、画素補間、HALFの量子化による小さな近似誤差だけを許容する。
			const angularFrequency = 8 * Math.PI;
			const sinusoid = textureShaderInput(texture(128, 16, x => gray(0.5 + 0.25 * Math.cos(angularFrequency * ((x + 0.5) / 128 - 0.5)))), { ...sampling, wrapMode: 'repeat' });
			const renderSinusoid = createEffect(128, 16, precise);
			const smoothedSinusoid = await renderSinusoid({ input: sinusoid, blurRadius: 0.03 });
			const attenuation = Math.exp(-0.5 * (angularFrequency * 0.03) ** 2);
			const expectedDerivative = 128 * 0.25 * attenuation * (Math.cos(angularFrequency * (69.5 / 128 - 0.5)) - Math.cos(angularFrequency * (68.5 / 128 - 0.5)));
			near(`${precision} Gaussian frequency response`, vectorAt(smoothedSinusoid, 128, 68, 8), [expectedDerivative, 0], 0.08);

			const renderWide = createEffect(32, 16, precise);
			const longSideBlur = await renderWide({ input: edge, blurRadius: 0.025, sizeReference: 'longSide' });
			const heightBlur = await renderWide({ input: edge, blurRadius: 0.05, sizeReference: 'height' });
			near(`${precision} equivalent Size Reference`, heightBlur, longSideBlur, 0);

			// 【FitとWrapを最終的な勾配まで引き継ぐ】
			// 中間テクスチャの寸法でFitを上書きしたり、画面端を常にclampしたりする誤りを検出する。
			const wideRamp = texture(32, 16, x => gray(x / 32));
			for (const [fitMode, expected] of [['stretch', 1], ['cover', 0.5], ['contain', 1]] as const) {
				near(`${precision} fit ${fitMode}`, vectorAt(await render({ input: textureShaderInput(wideRamp, { ...sampling, fitMode }), blurRadius: 0 }), 32, 16, 16), [expected, 0]);
			}
			const ramp = texture(32, 32, x => gray(x / 32));
			for (const [wrapMode, expected] of [['clamp', 0], ['repeat', -31], ['repeatMirrored', 0], ['transparent', -31]] as const) {
				near(`${precision} wrap ${wrapMode}`, vectorAt(await render({ input: textureShaderInput(ramp, { ...sampling, wrapMode }), blurRadius: 0 }), 32, 31, 16), [expected, 0]);
			}
			zero(`${precision} nearest has zero derivative`, await render({ input: textureShaderInput(ramp, { ...sampling, filterMode: 'nearest' }) }));
			near(`${precision} negative radius disables blur`, await render({ input: edge, blurRadius: -1 }), sharp, 0);
			zero(`${precision} zero strength`, await render({ input: edge, strength: 0 }));

			// 【定数・異なる寸法の画像を経由しても、同じ入力へ戻せば同じ結果になる】
			// 中間リソースの再確保やパイプラインのキャッシュに古い値が残る不具合を検出する。
			await render({ input: constantTexture });
			await render({ input: constantShaderInput('color', [1, 1, 1, 1]) });
			near(`${precision} deterministic after input changes`, await render({ input: edge, blurRadius: 0.05 }, 12345), smooth, 0);
		}
		const error = await device.popErrorScope();
		assert(error == null, error?.message ?? 'WebGPU validation failed');
		return { checks, supports32bit };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}
