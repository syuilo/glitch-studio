import { nativeEffectProbe } from './native-effect-probe.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import definition from '../../src/fx/radialSplit/_def_.ts';
import implementationNative from '../../src/fx/radialSplit/_impl_.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type RadialSplitParameters = NativeParameterValues<typeof definition.paramDefs>;
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
	const defaults: RadialSplitParameters = {
		inputs: definition.paramDefs.inputs.defaultValue.value.map(input => constantShaderInput('color', input.binding.value)),
		direction: definition.paramDefs.direction.defaultValue.value,
		gap: definition.paramDefs.gap.defaultValue.value,
		center: definition.paramDefs.center.defaultValue.value,
		startAngle: definition.paramDefs.startAngle.defaultValue.value,
		sizeReference: definition.paramDefs.sizeReference.defaultValue.value,
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
		return async (overrides: Partial<RadialSplitParameters> = {}, time = 0) => {
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
		const colors = [red, green, blue, hdr, [1, 1, 0, 1] as Color];
		const inputs = [red, green, blue, [4, -2, 1, 0.5] as Color, colors[4]].map(value => constantShaderInput('color', value));
		// 【異なる縦横比でも上向きから指定方向へ均等な角度で分割する】
		// 境界から離れた画素を角度だけから分類し、画面比率による扇形の歪みや配列順の反転を検出する。
		for (const [width, height] of [[40, 24], [24, 40], [33, 33]]) {
			const render = createEffect(width, height);
			for (const count of [2, 3, 4, 5]) {
				for (const direction of ['clockwise', 'counterclockwise'] as const) {
					const startAngle = 0.07;
					const center = [0.05, -0.025] as [number, number];
					const pixels = await render({ inputs: inputs.slice(0, count), direction, startAngle, center });
					let compared = 0;
					for (let y = 0; y < height; y++) {
						for (let x = 0; x < width; x++) {
							const relativeX = x + 0.5 - width / 2 - center[0] * Math.max(width, height);
							const relativeY = height / 2 - y - 0.5 - center[1] * Math.max(width, height);
							const turn = (Math.atan2(relativeX, relativeY) / (2 * Math.PI) - startAngle) * (direction === 'clockwise' ? 1 : -1);
							const sectorPosition = (turn - Math.floor(turn)) * count;
							const fraction = sectorPosition - Math.floor(sectorPosition);
							const nearestAngle = Math.min(fraction, 1 - fraction) * 2 * Math.PI / count;
							if (Math.hypot(relativeX, relativeY) * Math.sin(nearestAngle) < 2) continue;
							const expected = colors[Math.floor(sectorPosition)];
							for (let channel = 0; channel < 4; channel++) {
								const value = pixels[(y * width + x) * 4 + channel];
								if (!Number.isFinite(value) || Math.abs(value - expected[channel]) > 0.002) throw new Error(`${count} sectors ${direction} ${width}x${height}: pixel ${x},${y} channel ${channel}`);
							}
							compared++;
						}
					}
					if (compared < width * height / 4) throw new Error('Too few sector interior pixels checked');
					checks.push(`${count} sectors ${direction} ${width}x${height}`);
				}
			}
		}

		// 【一定幅のGapと中心の空きを、解像度を変えても同じ比率で保つ】
		// 角度によるGapでは中心からの距離で幅が変わるため、全画素を既知の十字形の隙間と照合する。
		for (const scale of [1, 2]) {
			const width = 32 * scale;
			const height = 16 * scale;
			const render = createEffect(width, height);
			compare(await render({ inputs: inputs.slice(0, 4), gap: 0.125 }), image(width, height, (x, y) => {
				const physicalX = x + 0.5 - width / 2;
				const physicalY = height / 2 - y - 0.5;
				if (Math.abs(physicalX) < 2 * scale || Math.abs(physicalY) < 2 * scale) return transparent;
				return physicalX > 0 ? physicalY > 0 ? red : green : physicalY < 0 ? blue : hdr;
			}), `constant-width gap at scale ${scale}`);
		}

		// 【Gapの寸法基準を切り替えても、両側の隙間に同じ物理的な幅を使う】
		// 長辺・短辺・幅・高さを出力寸法から換算し、扇形自身の外接矩形を基準にしないことを確認する。
		const renderReferences = createEffect(32, 16);
		for (const [sizeReference, halfGap] of [['longSide', 2], ['shortSide', 1], ['width', 2], ['height', 1]] as const) {
			compare(await renderReferences({ inputs: inputs.slice(0, 4), gap: 0.125, sizeReference }), image(32, 16, (x, y) => {
				const relativeX = x + 0.5 - 16;
				const relativeY = 8 - y - 0.5;
				if (Math.abs(relativeX) < halfGap || Math.abs(relativeY) < halfGap) return transparent;
				return relativeX > 0 ? relativeY > 0 ? red : green : relativeY < 0 ? blue : hdr;
			}), `${sizeReference} gap reference`);
		}

		// 【斜めの境界でも隙間の幅を半径に依存させない】
		// 角度と半径から境界までの距離を独立に求め、AA領域を除いた画像と隙間の両方を照合する。
		const obliquePixels = await createEffect(64, 40)({ inputs: inputs.slice(0, 3), startAngle: 0.07, gap: 0.125 });
		let gapChecks = 0;
		for (let y = 0; y < 40; y++) {
			for (let x = 0; x < 64; x++) {
				const relativeX = x + 0.5 - 32;
				const relativeY = 20 - y - 0.5;
				const turn = Math.atan2(relativeX, relativeY) / (2 * Math.PI) - 0.07;
				const sectorPosition = (turn - Math.floor(turn)) * 3;
				const fraction = sectorPosition - Math.floor(sectorPosition);
				const distance = Math.hypot(relativeX, relativeY) * Math.sin(Math.min(fraction, 1 - fraction) * 2 * Math.PI / 3);
				if (Math.abs(distance - 4) < 2) continue;
				const expected = distance < 4 ? transparent : colors[Math.floor(sectorPosition)];
				for (let channel = 0; channel < 4; channel++) {
					const value = obliquePixels[(y * 64 + x) * 4 + channel];
					if (!Number.isFinite(value) || Math.abs(value - expected[channel]) > 0.002) throw new Error(`Oblique gap at ${x},${y}: channel ${channel}`);
				}
				if (distance < 4) gapChecks++;
			}
		}
		if (gapChecks < 100) throw new Error('Too few oblique gap pixels checked');
		checks.push('oblique gaps keep constant pixel width');

		// 【画像はGapを引いた後の矩形へFitし、正立したまま左右に配置する】
		// 4ピクセルのGapで各入力の配置先は4×8となる。Gap前の矩形を使うと画像の画素位置が一致しない。
		const sourcePixel = (x: number, y: number): Color => [x / 4, y / 8, 2, 0.5];
		const source = texture(4, 8, image(4, 8, sourcePixel));
		const renderPair = createEffect(12, 8);
		compare(await renderPair({ inputs: [source, source], gap: 1 / 3 }), image(12, 8, (x, y) => x < 4 ? sourcePixel(x, y) : x >= 8 ? sourcePixel(x - 8, y) : transparent), 'fits textures after removing gap');
		compare(await renderPair({ inputs: [source, source] }), image(12, 8, (x, y) => sourcePixel(Math.floor((x % 6 + 0.5) * 4 / 6), y)), 'closing gap expands image bounds');
		compare(await renderPair({ inputs: [source, source], gap: 1 / 3 }), image(12, 8, (x, y) => x < 4 ? sourcePixel(x, y) : x >= 8 ? sourcePixel(x - 8, y) : transparent), 'gap changes update existing resources');

		// 【扇形ごとの異なる矩形に対して、Fit・Wrap・Filterを独立に適用する】
		// 中心を右へずらすと右側が正方形、左側が横長になる。同じ素材でもCoverの参照範囲が異なる。
		const widePixel = (x: number, y: number): Color => [x / 4, y / 2, 2, 0.5];
		const wide = texture(4, 2, image(4, 2, widePixel));
		if (wide.kind !== 'texture') throw new Error('Test source must be a texture');
		const renderFit = createEffect(12, 8);
		const cover = { ...wide, sampling: { ...wide.sampling, fitMode: 'cover' as const } };
		const contain = { ...wide, sampling: { ...wide.sampling, fitMode: 'contain' as const, wrapMode: 'transparent' as const } };
		const center: [number, number] = [1 / 6, 0];
		compare(await renderFit({ inputs: [cover, cover, cover, cover], center }), image(12, 8, (x, y) => widePixel(x >= 8 ? 1 + Math.floor((x - 8) / 2) : Math.floor(x / 2), Math.floor((y % 4) / 2))), 'cover fits each independent sector rectangle');
		compare(await renderFit({ inputs: [contain, contain, cover, cover], center }), image(12, 8, (x, y) => {
			if (x < 8) return widePixel(Math.floor(x / 2), Math.floor((y % 4) / 2));
			return y % 4 === 0 || y % 4 === 3 ? transparent : widePixel(x - 8, y % 4 - 1);
		}), 'contain clips only its own square regions');
		const repeat = { ...contain, sampling: { ...contain.sampling, wrapMode: 'repeat' as const } };
		compare(await renderFit({ inputs: [repeat, repeat, cover, cover], center }), image(12, 8, (x, y) =>
			x >= 8 ? widePixel(x - 8, (y + 1) % 2) : widePixel(Math.floor(x / 2), Math.floor((y % 4) / 2))), 'wrap remains local to each fitted image');

		// 【入力0個・1個・透明な入力と過大なGapで、配列切替後の描画を残さない】
		// 透明入力にも領域を予約し、入力数でgeometry bufferとpipelineが変わっても古い内容を使わない。
		const render = createEffect(12, 8);
		compare(await render(), image(12, 8, () => transparent), 'default inputs are transparent');
		compare(await render({ inputs: [inputs[0]], gap: 100, center: [10, 10], startAngle: 0.3 }), image(12, 8, () => red), 'single input ignores splitting controls');
		compare(await render({ inputs: [] }), image(12, 8, () => transparent), 'empty inputs clear previous image');
		compare(await render({ inputs: [inputs[0], constantShaderInput('color', transparent)] }), image(12, 8, x => x >= 6 ? red : transparent), 'transparent input retains its half');
		compare(await render({ inputs: inputs.slice(0, 4), gap: 2 }), image(12, 8, () => transparent), 'excessive gap removes all regions');
		compare(await render({ inputs: [inputs[1], inputs[0]], gap: -1 }), image(12, 8, x => x >= 6 ? green : red), 'reordering and negative gap');
		compare(await render({ inputs: inputs.slice(0, 4), center: [2, 0] }), image(12, 8, (_, y) => y < 4 ? hdr : blue), 'offscreen center retains original input indices');

		// 【GapなしのAAで不透明な画像間に透明線や中心の穴を作らない】
		// 3本以上の境界が集まる箇所も、同じ入力色なら全画素が同じRGBAとなることを確認する。
		for (const count of [3, 5]) {
			compare(await createEffect(33, 25)({ inputs: Array(count).fill(inputs[3]), startAngle: 0.07 }), image(33, 25, () => hdr), `${count} sectors preserve HDR across antialiased joins`);
		}
		const renderCenter = createEffect(9, 5);
		const centerPixels = await renderCenter({ inputs: inputs.slice(0, 2) });
		compare(centerPixels.slice((2 * 9 + 4) * 4, (2 * 9 + 4) * 4 + 4), [red], 'exact center uses the first input');
		compare(centerPixels.slice(4 * 4, 4 * 4 + 4), [[0.5, 0.5, 0, 1]], 'zero-gap boundary blends adjacent images');
		const renderAntialias = createEffect(8, 4);
		compare(await renderAntialias({ inputs: inputs.slice(0, 2), gap: 0.125 }), image(8, 4, x => {
			if (x === 3) return [0, 0.5, 0, 0.5];
			if (x === 4) return [0.5, 0, 0, 0.5];
			return x < 4 ? green : red;
		}), 'gap edges have transparent antialiasing');

		// 【画像のFilterは乗算済みRGBAを補間し、時刻や描画履歴で結果を変えない】
		// 透明との補間でHDR・負値をclampしたり、alphaを二重乗算したりしないことを確認する。
		const edge = texture(2, 1, [transparent, hdr]);
		const renderFilter = createEffect(4, 1);
		compare(await renderFilter({ inputs: [edge] }), [transparent, transparent, hdr, hdr], 'nearest preserves HDR source pixels');
		compare(await renderFilter({ inputs: [{ ...edge, sampling: { ...edge.sampling, filterMode: 'linear' } }] }), [transparent, [0.5, -0.25, 0.125, 0.125], [1.5, -0.75, 0.375, 0.375], hdr], 'linear samples premultiplied HDR');
		compare(await renderFilter({ inputs: [edge] }, 10), [transparent, transparent, hdr, hdr], 'output is independent of time and previous frames');

		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks };
	} finally {
		for (const dispose of disposers.reverse()) dispose();
		device.destroy();
	}
}
