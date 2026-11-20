import { nativeEffectProbe } from './native-effect-probe.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/splitLayout/_def_.ts';
import implementationNative from '../../src/fx/splitLayout/_impl_.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type SplitLayoutParameters = NativeParameterValues<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const transparent: Color = [0, 0, 0, 0];
const colorA: Color = [2, -1, 0.5, 0.5];
const colorB: Color = [-0.5, 1, 0, 0.25];
const image = (width: number, height: number, pixelAt: (x: number, y: number) => Color) =>
	Array.from({ length: width * height }, (_, index) => pixelAt(index % width, Math.floor(index / width)));

// 実装の多角形クリップとは独立に、二つの一様分布の和の累積分布を積分する。
// 1画素内の直線以下の面積を厳密に求め、斜めの被覆率を同じ実装同士で比較しない。
function coverage(normal: [number, number], distance: number) {
	const a = Math.abs(normal[0]);
	const b = Math.abs(normal[1]);
	const threshold = distance + (a + b) / 2;
	if (threshold <= 0) return 0;
	if (threshold >= a + b) return 1;
	if (a < 1e-10) return threshold / b;
	if (b < 1e-10) return threshold / a;
	return (threshold ** 2 - Math.max(0, threshold - a) ** 2 - Math.max(0, threshold - b) ** 2) / (2 * a * b);
}

function expectedColors(width: number, height: number, angle: number, offset: number, gap: number, a = colorA, b = colorB) {
	const normal: [number, number] = [Math.sin(angle * 2 * Math.PI), Math.cos(angle * 2 * Math.PI)];
	const longSide = Math.max(width, height);
	return image(width, height, (x, y) => {
		const projection = (x + 0.5 - width / 2) * normal[0] + (height / 2 - y - 0.5) * normal[1];
		const weightA = coverage(normal, (offset - Math.max(0, gap) / 2) * longSide - projection);
		const weightB = 1 - coverage(normal, (offset + Math.max(0, gap) / 2) * longSide - projection);
		return a.map((value, channel) => value * weightA + b[channel] * weightB) as Color;
	});
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	let comparisons = 0;
	const defaults: SplitLayoutParameters = {
		inputA: constantShaderInput('color', definition.paramDefs.inputA.defaultValue),
		inputB: constantShaderInput('color', definition.paramDefs.inputB.defaultValue),
		angle: definition.paramDefs.angle.defaultValue,
		offset: definition.paramDefs.offset.defaultValue,
		gap: definition.paramDefs.gap.defaultValue,
		sizeReference: definition.paramDefs.sizeReference.defaultValue,
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
		return async (overrides: Partial<SplitLayoutParameters> = {}, time = 0) => {
			const commandEncoder = device.createCommandEncoder();
			await instance.draw({
				params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 16,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
			});
			const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(3); pass.end();
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

	function compare(actual: Float32Array, expected: Color[] | Float32Array, label: string, tolerance = 0.003, includePixel: (index: number) => boolean = () => true) {
		const channels = expected instanceof Float32Array ? expected : expected.flat();
		if (actual.length !== channels.length) throw new Error(`${label}: wrong output dimensions`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || (includePixel(Math.floor(index / 4)) && Math.abs(value - channels[index]) > tolerance)) {
				throw new Error(`${label}: pixel ${Math.floor(index / 4)} channel ${index % 4}: ${value} != ${channels[index]}`);
			}
		});
		comparisons++;
	}

	try {
		// 【任意角の被覆率を独立した積分式と照合し、HDRと半透明を保つ】
		// 非正方形・端数寸法・画面外のOffset・大きなGapでも、線を歪めたり端点を補正しない。
		for (const [width, height] of [[16, 9], [9, 16], [9, 9]]) {
			const render = createEffect(width, height);
			compare(await render(), image(width, height, () => transparent), 'unconnected defaults');
			for (const angle of [0, 0.125, 0.25, 123 / 360, 0.5, 0.75]) {
				for (const offset of [-0.75, 0, 0.18]) {
					for (const gap of [0, 0.02, 2]) {
						compare(await render({ ...inputs, angle, offset, gap }), expectedColors(width, height, angle, offset, gap), `coverage ${width}x${height} ${angle} ${offset} ${gap}`);
					}
				}
			}
		}
		checks.push('arbitrary-angle coverage with HDR and alpha');

		// 【Gapの単位だけをSize Referenceで換算し、Offsetの共通単位は変えない】
		// 同じ構図の解像度変更、横長・縦長で距離の基準を取り違えないようにする。
		for (const scale of [1, 2]) {
			for (const [width, height] of [[16 * scale, 8 * scale], [8 * scale, 16 * scale]]) {
				const render = createEffect(width, height);
				for (const [sizeReference, reference] of [['longSide', 16 * scale], ['shortSide', 8 * scale], ['width', width], ['height', height]] as const) {
					compare(await render({ ...inputs, angle: 0.125, offset: 0.125, gap: 0.25, sizeReference }), expectedColors(width, height, 0.125, 0.125, 0.25 * reference / (16 * scale)), 'size reference with fixed offset');
				}
			}
		}
		checks.push('size references and resolution independence');

		// 【負のGapと透明な入力でも、領域とアンチエイリアスの規則を維持する】
		// 入力のalphaから配置を再計算したり、半透明同士をsource-overで重ねたりしない。
		const renderSmall = createEffect(9, 5);
		compare(await renderSmall({ ...inputs, gap: -1 }), expectedColors(9, 5, 0.25, 0, 0), 'negative gap');
		compare(await renderSmall({ inputA: inputs.inputA, angle: 0.125, offset: -0.1 }), expectedColors(9, 5, 0.125, -0.1, 0, colorA, transparent), 'transparent region');
		checks.push('transparent inputs and negative gap');

		// 【斜めの三角形の画像中心を既知の面積重心へ合わせ、正立を維持する】
		// 定数色では外接矩形中心への配置ミスを検出できないため、座標を色にした画像を読む。
		// 境界のAAは別の積分テストで検証し、ここでは完全被覆画素の参照座標を照合する。
		const gradient = texture(16, 16, image(16, 16, (x, y) => [(x + 0.5) / 8 - 1, (y + 0.5) / 16, 2, 1]), { fitMode: 'cover', filterMode: 'linear' });
		for (const [width, height] of [[24, 24], [32, 18], [18, 32]]) {
			const longSide = Math.max(width, height);
			const halfWidth = width / (2 * longSide), halfHeight = height / (2 * longSide);
			const angle = Math.atan2(halfHeight, halfWidth) / (2 * Math.PI);
			const normal = [Math.sin(angle * 2 * Math.PI), Math.cos(angle * 2 * Math.PI)];
			const render = createEffect(width, height);
			const expected = image(width, height, (x, y) => {
				const px = (x + 0.5 - width / 2) / longSide, py = (height / 2 - y - 0.5) / longSide;
				const sign = px * normal[0] + py * normal[1] < 0 ? -1 : 1;
				const centerX = sign * halfWidth / 3, centerY = sign * halfHeight / 3;
				// 入力は正方形なので、Coverの一辺は重心を中心とする配置枠の長辺。
				const halfSide = Math.max(halfWidth, halfHeight) * 4 / 3;
				const u = Math.min(31 / 32, Math.max(1 / 32, 0.5 + (px - centerX) / (2 * halfSide)));
				const v = Math.min(31 / 32, Math.max(1 / 32, 0.5 - (py - centerY) / (2 * halfSide)));
				return [u * 2 - 1, v, 2, 1];
			});
			compare(await render({ inputA: gradient, inputB: gradient, angle }), expected, 'centroid-centered upright Cover', 0.003, index => {
				const x = index % width, y = Math.floor(index / width);
				const distance = (x + 0.5 - width / 2) * normal[0] + (height / 2 - y - 0.5) * normal[1];
				return Math.abs(distance) > 1;
			});
		}
		checks.push('centroid placement and upright Cover');

		// 【入力ごとのFit・Wrapと定数／画像の全組合せを維持する】
		// 配置枠の寸法を出力全体の寸法として扱う誤りや、角度反転での鏡像化を検出する。
		const sourcePixel = (x: number, y: number): Color => [x / 4, y / 2, 2, 0.5];
		const source = texture(4, 2, image(4, 2, sourcePixel));
		const cover = { ...source, sampling: { ...source.sampling, fitMode: 'cover' as const } };
		const contain = { ...source, sampling: { ...source.sampling, fitMode: 'contain' as const, wrapMode: 'transparent' as const } };
		const renderFit = createEffect(8, 4);
		compare(await renderFit({ inputA: source, inputB: cover }), image(8, 4, (x, y) => sourcePixel(x < 4 ? x : Math.floor((x - 4) / 2) + 1, Math.floor(y / 2))), 'independent stretch and cover');
		compare(await renderFit({ inputA: source, inputB: source, angle: 0.75 }), image(8, 4, (x, y) => sourcePixel(x % 4, Math.floor(y / 2))), 'reversed direction keeps images upright');
		compare(await renderFit({ inputA: contain, inputB: inputs.inputB }), image(8, 4, (x, y) => x >= 4 ? colorB : y === 0 || y === 3 ? transparent : sourcePixel(x, y - 1)), 'contain with transparent wrap');
		compare(await renderFit({ inputA: inputs.inputA, inputB: source }), image(8, 4, (x, y) => x < 4 ? colorA : sourcePixel(x - 4, Math.floor(y / 2))), 'uniform and texture');
		compare(await renderFit({ inputA: { ...contain, sampling: { ...contain.sampling, wrapMode: 'repeat' } }, inputB: cover }), image(8, 4, (x, y) => x < 4 ? sourcePixel(x, (y + 1) % 2) : sourcePixel(Math.floor((x - 4) / 2) + 1, Math.floor(y / 2))), 'repeat inside region');
		checks.push('per-input fitting and sampling variants');

		// 【1px未満の領域は、実際に覆った部分の中心から読み出す】
		// 画素中心をそのまま使うと細い配置枠の外へ飛び、Repeatで別の色を拾ってしまう。
		compare(await renderFit({ inputA: { ...source, sampling: { ...source.sampling, wrapMode: 'repeat' } }, inputB: inputs.inputB, offset: -0.46875 }), image(8, 4, (x, y) => {
			if (x > 0) return colorB;
			return sourcePixel(2, Math.floor(y / 2)).map((value, channel) => value * 0.25 + colorB[channel] * 0.75) as Color;
		}), 'covered sample center of subpixel region');
		checks.push('subpixel image sampling');

		// 【Gapの有無や角度にかかわらず、Coverの画像で領域全体を埋める】
		// 重心へ移すだけで拡大率を調整しないと、斜め領域の端に透明な穴が残る。
		const solidA = texture(2, 1, image(2, 1, () => colorA), { fitMode: 'cover', wrapMode: 'transparent' });
		const solidB = texture(1, 2, image(1, 2, () => colorB), { fitMode: 'cover', wrapMode: 'transparent' });
		for (const angle of [0.125, 123 / 360, 0.65]) {
			compare(await renderSmall({ inputA: solidA, inputB: solidB, angle, offset: -0.18, gap: 0.02 }), expectedColors(9, 5, angle, -0.18, 0.02), 'centroid Cover leaves no holes');
		}
		checks.push('Cover fills polygonal regions');

		// 【前の配置・時刻に依存せず同じ入力から同じ結果を得る】
		// 空領域の描画後にもuniformやbindingを更新し、以前の描画を残さない。
		const params = { inputA: source, inputB: cover, angle: 123 / 360, offset: -0.18, gap: 0.02 };
		const baseline = await renderFit(params);
		await renderFit({ ...inputs, gap: 2 });
		compare(await renderFit(params, 100), baseline, 'deterministic layout after empty frame', 0);
		checks.push('time and history independence');
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, comparisons };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}
