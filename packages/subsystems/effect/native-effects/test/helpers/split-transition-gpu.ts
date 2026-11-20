import { nativeEffectProbe } from './native-effect-probe.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/splitTransition/_def_.ts';
import implementationNative from '../../src/fx/splitTransition/_impl_.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type SplitTransitionParameters = NativeParameterValues<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const transparent: Color = [0, 0, 0, 0];
const colorA: Color = [2, -1, 0.5, 0.5];
const colorB: Color = [-0.5, 1, 0, 0.25];
const image = (width: number, height: number, pixelAt: (x: number, y: number) => Color) =>
	Array.from({ length: width * height }, (_, index) => pixelAt(index % width, Math.floor(index / width)));
const weightedColor = (coverageA: number, coverageB: number): Color =>
	colorA.map((value, channel) => value * coverageA + colorB[channel] * coverageB) as Color;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	let comparisons = 0;
	const defaults: SplitTransitionParameters = {
		inputA: constantShaderInput('color', definition.paramDefs.inputA.defaultValue.value),
		inputB: constantShaderInput('color', definition.paramDefs.inputB.defaultValue.value),
		progress: definition.paramDefs.progress.defaultValue.value,
		direction: definition.paramDefs.direction.defaultValue.value,
		reverse: definition.paramDefs.reverse.defaultValue.value,
		gap: definition.paramDefs.gap.defaultValue.value,
		sizeReference: definition.paramDefs.sizeReference.defaultValue.value,
	};
	const inputs = {
		inputA: constantShaderInput('color', [4, -2, 1, 0.5]),
		inputB: constantShaderInput('color', [-2, 4, 0, 0.25]),
	};
	const sampling: ShaderInputSampling = { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' };
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
		targets: [{ format: 'rgba32float' }],
	} });

	function texture(width: number, height: number, pixels: Color[], overrides: Partial<ShaderInputSampling> = {}) {
		const source = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture: source }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, height]);
		disposers.push(() => source.destroy());
		return textureShaderInput(source, { ...sampling, ...overrides });
	}

	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.createTexture('output', { wgpu, resolution });
		if (output.format !== 'rgba16float') throw new Error('Image output must remain rgba16float');
		const instance = implementation.place(wgpu, resolution);
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
		const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposers.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<SplitTransitionParameters> = {}, time = 0) => {
			const commandEncoder = device.createCommandEncoder();
			await instance.draw({
				params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 16,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
			});
			const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			commandEncoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const data = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(data.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
	}

	function compare(actual: Float32Array, expected: Color[] | Float32Array, label: string, tolerance = 0.002) {
		const channels = expected instanceof Float32Array ? expected : expected.flat();
		if (actual.length !== channels.length) throw new Error(`${label}: wrong output dimensions`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || Math.abs(value - channels[index]) > tolerance) {
				throw new Error(`${label}: pixel ${Math.floor(index / 4)} channel ${index % 4}: ${value} != ${channels[index]}`);
			}
		});
		comparisons++;
	}

	try {
		// 【進捗の端点は方向・配置順・Gapによらず全面A/Bになる】
		// 大きなGapや面積0の領域でも余白・NaN・以前の描画が残らず、HDRと半透明を保つ。
		for (const [width, height] of [[16, 8], [8, 16], [9, 9]]) {
			const render = createEffect(width, height);
			compare(await render(), image(width, height, () => transparent), 'unconnected defaults are transparent');
			for (const direction of ['horizontal', 'vertical'] as const) {
				for (const reverse of [false, true]) {
					for (const gap of [0, 0.125, 100]) {
						for (const progress of [-1, 0, 1, 2]) {
							compare(await render({ ...inputs, direction, reverse, gap, progress }), image(width, height, () => progress <= 0 ? colorA : colorB), `endpoints ${width}x${height} ${direction} ${reverse} ${gap} ${progress}`);
						}
					}
				}
			}
		}
		checks.push('clamped endpoints with HDR and alpha');

		// 【Gap=0で領域の比率を進捗に合わせ、Reverseは配置順だけを変える】
		// 左右・上下と縦横比を変えても同じ規則で配置し、負のGapを0として扱う。
		for (const [width, height] of [[16, 8], [8, 16], [12, 12]]) {
			const render = createEffect(width, height);
			for (const direction of ['horizontal', 'vertical'] as const) {
				for (const reverse of [false, true]) {
					for (const progress of [0.25, 0.5, 0.75]) {
						const length = direction === 'vertical' ? height : width;
						compare(await render({ ...inputs, direction, reverse, progress, gap: -1 }), image(width, height, (x, y) => {
							const position = direction === 'vertical' ? y : x;
							return reverse ? position < length * progress ? colorB : colorA : position < length * (1 - progress) ? colorA : colorB;
						}), 'region ratio and order');
					}
				}
			}
		}
		checks.push('region proportions and ordering');

		// 【透明帯の幅を保ちながら画面外まで移動する】
		// 既知の境界位置で確認し、端点付近で1px未満のBが突然出現する誤りも検出する。
		const renderGap = createEffect(16, 8);
		for (const reverse of [false, true]) {
			for (const [progress, columns] of [
				[0.125, [...Array<Color>(13).fill(colorA), weightedColor(0.75, 0), transparent, weightedColor(0, 0.25)]],
				[0.25, [...Array<Color>(11).fill(colorA), weightedColor(0.5, 0), transparent, weightedColor(0, 0.5), colorB, colorB]],
				[0.5, [...Array<Color>(7).fill(colorA), transparent, transparent, ...Array<Color>(7).fill(colorB)]],
			] as const) {
				compare(await renderGap({ ...inputs, gap: 0.125, progress, reverse }), image(16, 8, x => columns[reverse ? 15 - x : x]), 'gap travel and fractional regions');
			}
		}
		compare(await renderGap({ ...inputs, gap: 100, progress: 0.5 }), image(16, 8, () => transparent), 'gap clamped to axis length');
		compare(await renderGap({ ...inputs, gap: 100, progress: 0.25, direction: 'vertical' }), image(16, 8, (_, y) => y < 4 ? colorA : transparent), 'oversized gap keeps endpoint travel');
		checks.push('gap travel and dimension limits');

		// 【Gapは出力のSize Referenceを使い、解像度を倍にしても相対配置を保つ】
		// 領域寸法や分割軸の長さを基準にすると、向き・進捗によってGapの幅が変わってしまう。
		for (const scale of [1, 2]) {
			for (const [width, height] of [[16 * scale, 8 * scale], [8 * scale, 16 * scale]]) {
				const render = createEffect(width, height);
				for (const direction of ['horizontal', 'vertical'] as const) {
					for (const [sizeReference, reference] of [['width', width], ['height', height], ['longSide', 16 * scale], ['shortSide', 8 * scale]] as const) {
						const length = direction === 'vertical' ? height : width;
						const gap = reference / 4;
						compare(await render({ ...inputs, progress: 0.5, gap: 0.25, direction, sizeReference }), image(width, height, (x, y) => {
							const position = direction === 'vertical' ? y : x;
							return position < (length - gap) / 2 ? colorA : position >= (length + gap) / 2 ? colorB : transparent;
						}), 'resolution-independent size reference');
					}
				}
			}
		}
		checks.push('size references and resolution independence');

		// 【境界の被覆率を加算し、透明・半透明同士でも継ぎ目を正しく補間する】
		// source-overや小さい領域の消去では、中央画素や1px未満の領域の色が一致しない。
		const renderOdd = createEffect(9, 5);
		compare(await renderOdd({ ...inputs, progress: 0.5 }), image(9, 5, x => x < 4 ? colorA : x > 4 ? colorB : weightedColor(0.5, 0.5)), 'fractional boundary preserves premultiplied alpha');
		compare(await renderOdd({ inputA: inputs.inputA, progress: 0.5 }), image(9, 5, x => x < 4 ? colorA : x > 4 ? transparent : weightedColor(0.5, 0)), 'transparent input retains its region');
		const renderThin = createEffect(8, 4);
		compare(await renderThin({ ...inputs, progress: 1 / 32 }), image(8, 4, x => x < 7 ? colorA : weightedColor(0.75, 0.25)), 'subpixel region coverage');
		compare(await renderThin({ ...inputs, progress: 0.5, gap: 0.0625 }), image(8, 4, x => x < 3 ? colorA : x === 3 ? weightedColor(0.75, 0) : x === 4 ? weightedColor(0, 0.75) : colorB), 'subpixel gap coverage');
		checks.push('subpixel coverage and transparent regions');

		// 【画像は領域の寸法でFitし、Reverseでも上下左右を鏡像化しない】
		// A/Bの幅が異なる場合と、片方だけがテクスチャの場合も独立したFitを確認する。
		const sourcePixel = (x: number, y: number): Color => [x / 4, y / 2, 2, 0.5];
		const source = texture(4, 2, image(4, 2, sourcePixel));
		if (source.kind !== 'texture') throw new Error('Test source must be a texture');
		const cover = { ...source, fitMode: 'cover' as const };
		const contain = { ...source, fitMode: 'contain' as const, wrapMode: 'transparent' as const };
		const renderFit = createEffect(8, 4);
		compare(await renderFit({ inputA: source, inputB: cover, progress: 0.5 }), image(8, 4, (x, y) => sourcePixel(x < 4 ? x : Math.floor((x - 4) / 2) + 1, Math.floor(y / 2))), 'stretch and cover fit each square region');
		compare(await renderFit({ inputA: source, inputB: cover, progress: 0.25 }), image(8, 4, (x, y) => sourcePixel(x < 6 ? Math.floor((x + 0.5) * 4 / 6) : x - 5, Math.floor(y / 2))), 'unequal regions have independent fitting');
		compare(await renderFit({ inputA: source, inputB: source, progress: 0.25, reverse: true }), image(8, 4, (x, y) => sourcePixel(x < 2 ? x * 2 + 1 : Math.floor((x - 1.5) * 4 / 6), Math.floor(y / 2))), 'reverse changes order without mirroring');
		compare(await renderFit({ inputA: source, inputB: source, progress: 0.5, direction: 'vertical' }), image(8, 4, (x, y) => sourcePixel(Math.floor(x / 2), y % 2)), 'vertical textures keep their orientation');
		for (const reverse of [false, true]) {
			compare(await renderFit({ inputA: contain, inputB: inputs.inputB, progress: 0.5, reverse }), image(8, 4, (x, y) => {
				const column = reverse ? x - 4 : x;
				return column < 0 || column >= 4 ? colorB : y === 0 || y === 3 ? transparent : sourcePixel(column, y - 1);
			}), 'texture and uniform inputs preserve contain margins');
		}
		compare(await renderFit({ inputA: inputs.inputA, inputB: source, progress: 0.5 }), image(8, 4, (x, y) => x < 4 ? colorA : sourcePixel(x - 4, Math.floor(y / 2))), 'uniform and texture input variant');
		const tall = texture(2, 4, image(2, 4, () => colorB), { fitMode: 'contain', wrapMode: 'transparent' });
		compare(await renderFit({ inputA: contain, inputB: tall, progress: 0.5 }), image(8, 4, (x, y) => x < 4 ? y === 0 || y === 3 ? transparent : sourcePixel(x, y - 1) : x === 4 || x === 7 ? transparent : colorB), 'different source aspect ratios');
		compare(await renderFit({ inputA: { ...contain, wrapMode: 'repeat' }, inputB: cover, progress: 0.5 }), image(8, 4, (x, y) => x < 4 ? sourcePixel(x, (y + 1) % 2) : sourcePixel(Math.floor((x - 4) / 2) + 1, Math.floor(y / 2))), 'wrap applies inside each region');
		checks.push('per-region fitting and unmapped image orientation');

		// 【入力のFilterを切り替えてもHDRと乗算済みRGBAをそのまま補間する】
		// 端点でも画像参照は接続設定に従い、A/Bの切替後に以前のbindingを使わない。
		const edge = texture(2, 1, [transparent, colorA]);
		const renderFilter = createEffect(4, 1);
		compare(await renderFilter({ inputA: edge }), [transparent, transparent, colorA, colorA], 'nearest preserves source pixels');
		const linearEdge = { ...edge, filterMode: 'linear' as const };
		compare(await renderFilter({ inputA: linearEdge }), [transparent, weightedColor(0.25, 0), weightedColor(0.75, 0), colorA], 'linear interpolates premultiplied HDR pixels');
		compare(await renderFilter({ inputB: linearEdge, progress: 1, reverse: true }), [transparent, weightedColor(0.25, 0), weightedColor(0.75, 0), colorA], 'B endpoint follows sampling settings');
		checks.push('input filters and endpoint sampling');

		// 【端点に近づいた画像は連続的に全面へ戻り、時刻や過去の描画に依存しない】
		// Gapを端点だけ無効化する実装では、直前との間で画像の配置が飛ぶ。
		const renderContinuity = createEffect(16, 8);
		const smooth = { ...cover, filterMode: 'linear' as const };
		for (const direction of ['horizontal', 'vertical'] as const) {
			for (const reverse of [false, true]) {
				for (const progress of [0, 1]) {
					const params = { inputA: smooth, inputB: smooth, direction, reverse, gap: 0.125, progress };
					const endpoint = await renderContinuity(params);
					compare(await renderContinuity({ ...params, progress: progress === 0 ? 0.000001 : 0.999999 }), endpoint, 'continuous textured endpoints', 0.004);
				}
			}
		}
		const params = { inputA: source, inputB: cover, progress: 0.375, gap: 0.125 };
		const baseline = await renderContinuity(params);
		await renderContinuity({ ...inputs, progress: 0.5, gap: 100 });
		compare(await renderContinuity(params, 100), baseline, 'time and history independence', 0);
		checks.push('continuous deterministic endpoints');

		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, comparisons };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}
