import { nativeEffectProbe } from './native-effect-probe.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/imageStack/_def_.ts';
import implementationNative from '../../src/fx/imageStack/_impl_.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type ImageStackParameters = NativeParameterValues<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const transparent: Color = [0, 0, 0, 0];
const red: Color = [1, 0, 0, 1];
const green: Color = [0, 1, 0, 1];
const blue: Color = [0, 0, 1, 1];
const hdr: Color = [2, -1, 0.5, 0.5];
const image = (width: number, height: number, pixelAt: (x: number, y: number) => Color) =>
	Array.from({ length: width * height }, (_, index) => pixelAt(index % width, Math.floor(index / width)));

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposers: (() => void)[] = [];
	const checks: string[] = [];
	const defaults: ImageStackParameters = {
		inputs: definition.paramDefs.inputs.defaultValue.map(input => constantShaderInput('color', input)),
		direction: definition.paramDefs.direction.defaultValue,
		gap: definition.paramDefs.gap.defaultValue,
		padding: definition.paramDefs.padding.defaultValue,
		sizeReference: definition.paramDefs.sizeReference.defaultValue,
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
		return async (overrides: Partial<ImageStackParameters> = {}, time = 0) => {
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

	function compare(actual: Float32Array, expected: Color[], label: string) {
		const channels = expected.flat();
		if (actual.length !== channels.length) throw new Error(`${label}: wrong output dimensions`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || Math.abs(value - channels[index]) > 0.002) {
				throw new Error(`${label}: pixel ${Math.floor(index / 4)} channel ${index % 4}: ${value} != ${channels[index]}`);
			}
		});
		checks.push(label);
	}

	try {
		const colors = [red, green, hdr];
		const inputs = [constantShaderInput('color', red), constantShaderInput('color', green), constantShaderInput('color', [4, -2, 1, 0.5])];
		// 【入力順・均等分割・半透明とHDRを、異なる縦横比と端数のあるセルで保つ】
		// 等分した寸法を整数へ丸めると解像度依存の余白が生じるため、全画素の所属領域を確認する。
		for (const [width, height] of [[12, 6], [6, 12], [10, 10]]) {
			const render = createEffect(width, height);
			compare(await render({ inputs }), image(width, height, x => colors[Math.floor((x + 0.5) * 3 / width)]), `horizontal ${width}x${height}`);
			compare(await render({ inputs, direction: 'vertical' }), image(width, height, (_, y) => colors[Math.floor((y + 0.5) * 3 / height)]), `vertical ${width}x${height}`);
			compare(await render({ inputs: [inputs[2], inputs[0]] }), image(width, height, x => x + 0.5 < width / 2 ? hdr : red), `reorder and remove ${width}x${height}`);
		}

		// 【外周余白と入力間隔は透明にし、Wrapで隣接領域へ漏らさない】
		// 同じ設定の解像度を2倍にしても、画像・余白・間隔がすべて同率で拡大することを確認する。
		for (const scale of [1, 2]) {
			const render = createEffect(16 * scale, 12 * scale);
			const pair = { inputs: inputs.slice(0, 2), gap: 0.125, padding: 0.0625 };
			compare(await render(pair), image(16 * scale, 12 * scale, (x, y) => {
				const column = Math.floor(x / scale);
				const row = Math.floor(y / scale);
				if (row < 1 || row >= 11) return transparent;
				return column >= 1 && column < 7 ? red : column >= 9 && column < 15 ? green : transparent;
			}), `horizontal gap and padding scale ${scale}`);
			compare(await render({ ...pair, direction: 'vertical' }), image(16 * scale, 12 * scale, (x, y) => {
				const column = Math.floor(x / scale);
				const row = Math.floor(y / scale);
				if (column < 1 || column >= 15) return transparent;
				return row >= 1 && row < 5 ? red : row >= 7 && row < 11 ? green : transparent;
			}), `vertical gap and padding scale ${scale}`);
		}

		// 【Size Referenceは縦横共通の寸法基準として使う】
		// 片軸だけを基準にしたり、出力ではなくセル寸法を参照したりする不具合を検出する。
		for (const [width, height] of [[16, 8], [8, 16]]) {
			const render = createEffect(width, height);
			for (const [sizeReference, padding] of [['width', width / 8], ['height', height / 8], ['longSide', 2], ['shortSide', 1]] as const) {
				compare(await render({ inputs: [inputs[0]], padding: 0.125, sizeReference }), image(width, height, (x, y) =>
					x >= padding && x < width - padding && y >= padding && y < height - padding ? red : transparent), `${sizeReference} padding ${width}x${height}`);
			}
		}

		// 【空配列・未接続・入力1個・過大な余白や間隔でも以前の描画を残さない】
		// 配列長によるパイプライン切替と面積0のFit計算を含め、透明出力と予約領域を確認する。
		const render = createEffect(12, 6);
		compare(await render(), image(12, 6, () => transparent), 'default inputs are transparent');
		compare(await render({ inputs: [inputs[0]], gap: 100 }), image(12, 6, () => red), 'single input ignores gap');
		compare(await render({ inputs: [] }), image(12, 6, () => transparent), 'empty inputs clear previous image');
		compare(await render({ inputs: [inputs[0], constantShaderInput('color', transparent), inputs[1]] }), image(12, 6, x => x < 4 ? red : x < 8 ? transparent : green), 'transparent input retains its region');
		compare(await render({ inputs, padding: 1 }), image(12, 6, () => transparent), 'excessive padding is transparent');
		compare(await render({ inputs, gap: 1 }), image(12, 6, () => transparent), 'excessive gap is transparent');
		compare(await render({ inputs, padding: -1, gap: -1 }), image(12, 6, x => colors[Math.floor(x / 4)]), 'negative dimensions behave as zero');

		// 【Fitは各領域の縦横比で行い、画像の上下と入力ごとの設定を保つ】
		// 出力全体へ先にFitすると、横長画像を正方形のセルへ入れた際に切り抜き位置が変わる。
		const sourcePixel = (x: number, y: number): Color => [x / 4, y / 2, 2, 0.5];
		const source = texture(4, 2, image(4, 2, sourcePixel));
		if (source.kind !== 'texture') throw new Error('Test source must be a texture');
		const renderFit = createEffect(8, 4);
		const cover = { ...source, sampling: { ...source.sampling, fitMode: 'cover' as const } };
		const contain = { ...source, sampling: { ...source.sampling, fitMode: 'contain' as const, wrapMode: 'transparent' as const } };
		compare(await renderFit({ inputs: [source, cover] }), image(8, 4, (x, y) => sourcePixel(x < 4 ? x : Math.floor((x - 4) / 2) + 1, Math.floor(y / 2))), 'stretch and cover fit each square cell');
		compare(await renderFit({ inputs: [contain, inputs[0]] }), image(8, 4, (x, y) => x >= 4 ? red : y === 0 || y === 3 ? transparent : sourcePixel(x, y - 1)), 'contain has transparent margins in its own region');
		compare(await renderFit({ inputs: [{ ...contain, sampling: { ...contain.sampling, wrapMode: 'repeat' } }, cover] }), image(8, 4, (x, y) =>
			x < 4 ? sourcePixel(x, (y + 1) % 2) : sourcePixel(Math.floor((x - 4) / 2) + 1, Math.floor(y / 2))), 'wrap applies inside each region');
		compare(await renderFit({ inputs: [source, source], direction: 'vertical' }), image(8, 4, (x, y) => sourcePixel(Math.floor(x / 2), y % 2)), 'vertical textures keep their orientation');

		// 【入力画像の寸法が異なっても、それぞれの縦横比と透明・HDRの値を保持する】
		// 定数とテクスチャの混在だけでなく、同じ配列内の各テクスチャで独立したFitを確認する。
		const tall = texture(2, 4, image(2, 4, () => hdr), { fitMode: 'contain', wrapMode: 'transparent' });
		compare(await renderFit({ inputs: [contain, tall] }), image(8, 4, (x, y) =>
			x < 4 ? y === 0 || y === 3 ? transparent : sourcePixel(x, y - 1) : x === 4 || x === 7 ? transparent : hdr), 'mixed source aspect ratios retain HDR and alpha');

		// 【Filterの切替で乗算済みRGBAをそのまま補間する】
		// 透明色との補間でalphaを再乗算したり、HDR・負値を切り捨てたりしないことを確認する。
		const edge = texture(2, 1, [transparent, hdr]);
		const renderFilter = createEffect(4, 1);
		compare(await renderFilter({ inputs: [edge] }), [transparent, transparent, hdr, hdr], 'nearest preserves source pixels');
		compare(await renderFilter({ inputs: [{ ...edge, sampling: { ...edge.sampling, filterMode: 'linear' } }] }), [transparent, [0.5, -0.25, 0.125, 0.125], [1.5, -0.75, 0.375, 0.375], hdr], 'linear interpolates premultiplied HDR pixels');
		compare(await renderFilter({ inputs: [edge] }, 10), [transparent, transparent, hdr, hdr], 'rendering is independent of time and prior frames');

		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}
