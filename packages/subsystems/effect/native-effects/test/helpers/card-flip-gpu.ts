import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/cardFlip/_def_.ts';
import implementationNative from '../../src/fx/cardFlip/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;

export async function run(includePreview = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.003) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
	const defaults: Parameters = {
		inputA: constantShaderInput('color', [4, -2, 1, 0.5]),
		inputB: constantShaderInput('color', [-2, 4, 0, 0.25]),
		background: constantShaderInput('color', [0, 0, 0, 0]),
		progress: scalar(0.25), flipDirection: 'right', perspective: 0.5, shading: 0.6,
	};
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});

	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			return pixels;
		} finally { target.destroy(); buffer.destroy(); }
	}

	function textureInput(width: number, height: number, values: number[], scalarTexture = false, filterMode: 'linear' | 'nearest' = 'linear') {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode, fitMode: 'stretch', wrapMode: 'clamp' });
	}

	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.createTexture('output', { wgpu, resolution });
		const instance = implementation.place(wgpu, resolution);
		disposables.push(() => { instance.dispose(); output.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			await instance.draw({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
			});
			device.queue.submit([encoder.finish()]);
			const pixels = await read(output);
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite output');
			return pixels;
		};
	}

	const pixelAt = (pixels: Float32Array, width: number, x: number, y: number) => pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
	const colorNear = (pixel: Float32Array, expected: readonly number[], label: string, tolerance = 0.003) => expected.forEach((value, channel) => near(pixel[channel], value, label, tolerance));
	const coordinateTexture = (width: number, height: number) => textureInput(width, height,
		Array.from({ length: width * height }, (_, index) => [(index % width + 0.5) / width, 1 - (Math.floor(index / width) + 0.5) / height, 0.25, 1]).flat());
	const directions = ['right', 'left', 'top', 'bottom'] as const;

	try {
		// 【全方向の端点は元のA/B、真横は背景そのもの】
		// 背景合成や陰影が端点を変えたり、cos(PI/2)の誤差で中央に線を残すことを防ぐ。
		const render = createEffect(65, 33);
		const background = constantShaderInput('color', [0.2, 0.4, 3, 0.5]);
		const backgroundColor = [0.1, 0.2, 1.5, 0.5];
		for (const flipDirection of directions) {
			for (const perspective of [0, 0.5, 1]) {
				for (const progress of [-1, 0, 0.000001, 0.5, 0.999999, 1, 2]) {
					const pixels = await render({ background, flipDirection, perspective, shading: 1, progress: scalar(progress) });
					const expected = progress === 0.5 ? backgroundColor : progress < 0.5 ? colorA : colorB;
					pixels.forEach((value, index) => near(value, expected[index % 4], 'endpoint or midpoint'));
				}
			}
		}
		checks.push('four directions endpoints and midpoint');

		// 【表裏とも画像の向きを保ち、終端直前にも反転しない】
		// 座標を色へ符号化して、左右/上下の取り違えと裏側UVの鏡像を検出する。
		// 縦長・横長の両方で、回転と直交する軸が伸縮しないことも確認する。
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const sample = createEffect(width, height);
			const inputA = coordinateTexture(width, height);
			const inputB = coordinateTexture(width, height);
			for (const flipDirection of directions) {
				for (const progress of [0.25, 0.75]) {
					const pixels = await sample({ inputA, inputB, flipDirection, progress: scalar(progress), perspective: 0, shading: 0 });
					const horizontal = flipDirection === 'right' || flipDirection === 'left';
					for (const [x, y] of [[Math.floor(width * 0.35), Math.floor(height * 0.4)], [Math.floor(width * 0.65), Math.floor(height * 0.6)]]) {
						const sourceX = ((x + 0.5) / width - 0.5) / (horizontal ? Math.SQRT1_2 : 1) + 0.5;
						const sourceY = (0.5 - (y + 0.5) / height) / (horizontal ? 1 : Math.SQRT1_2) + 0.5;
						colorNear(pixelAt(pixels, width, x, y), [sourceX, sourceY, 0.25, 1], 'oriented face');
					}
				}
				for (const endpoint of [0, 1]) {
					const exact = await sample({ inputA, inputB, flipDirection, progress: scalar(endpoint) });
					const close = await sample({ inputA, inputB, flipDirection, progress: scalar(endpoint === 0 ? 0.000001 : 0.999999) });
					equal(close, exact, 'continuous textured endpoint');
				}
			}
		}
		checks.push('front and back orientation and continuous textures');

		// 【指定した辺が手前に来る透視投影】
		// 材料点を先に3Dで回転・投影し、その最寄り画素の色を独立に求める。
		// 反対向きの遠近感、透視補正されない画像、縦横比による歪みを検出する。
		for (const [width, height] of [[161, 81], [81, 161]]) {
			const sample = createEffect(width, height);
			const inputA = coordinateTexture(width, height);
			const inputB = coordinateTexture(width, height);
			const longest = Math.max(width, height);
			for (const flipDirection of directions) {
				const horizontal = flipDirection === 'right' || flipDirection === 'left';
				const sign = flipDirection === 'right' || flipDirection === 'top' ? 1 : -1;
				for (const progress of [0.3, 0.7]) {
					const pixels = await sample({ inputA, inputB, flipDirection, progress: scalar(progress), perspective: 1, shading: 0 });
					for (const side of [-1, 1]) {
						const materialAlong = side * 0.3 * (horizontal ? width : height) / longest;
						const materialAcross = 0.12 * (horizontal ? height : width) / longest;
						const angle = progress * Math.PI;
						const z = materialAlong * Math.sin(angle);
						const projectedAlong = materialAlong * Math.cos(angle) / (1 - z);
						const projectedAcross = materialAcross / (1 - z);
						const screenX = sign * (horizontal ? projectedAlong : -projectedAcross);
						const screenY = sign * (horizontal ? projectedAcross : projectedAlong);
						const x = Math.floor(width * 0.5 + screenX * longest);
						const y = Math.floor(height * 0.5 - screenY * longest);
						const actualX = (x + 0.5 - width * 0.5) / longest;
						const actualY = (height * 0.5 - y - 0.5) / longest;
						const along = sign * (horizontal ? actualX : actualY);
						const across = sign * (horizontal ? actualY : -actualX);
						const sourceAlong = along / (Math.cos(angle) + along * Math.sin(angle));
						const sourceAcross = across * (1 - sourceAlong * Math.sin(angle));
						const orientedAlong = sourceAlong * (progress > 0.5 ? -1 : 1);
						const sourceX = sign * (horizontal ? orientedAlong : -sourceAcross);
						const sourceY = sign * (horizontal ? sourceAcross : orientedAlong);
						colorNear(pixelAt(pixels, width, x, y), [0.5 + sourceX * longest / width, 0.5 + sourceY * longest / height, 0.25, 1], 'perspective material', 0.005);
					}
				}
			}
		}
		checks.push('perspective projection and direction');

		// 【真横付近の面積と輪郭は連続し、透明なカードを背景で埋めない】
		// 平行投影では投影幅を厳密に求められる。1px未満の板も面積どおりに消える必要がある。
		const square = createEffect(65, 65);
		for (const progress of [0.25, 0.499, 0.49999, 0.50001, 0.501, 0.75]) {
			const pixels = await square({ background, progress: scalar(progress), perspective: 0, shading: 0 });
			const halfWidth = Math.abs(Math.cos(progress * Math.PI)) * 32.5;
			const face = progress < 0.5 ? colorA : colorB;
			for (let x = 0; x < 65; x++) {
				const coverage = Math.max(0, Math.min(x + 1, 32.5 + halfWidth) - Math.max(x, 32.5 - halfWidth));
				colorNear(pixelAt(pixels, 65, x, 32), backgroundColor.map((value, channel) => value * (1 - coverage) + face[channel] * coverage), 'geometric coverage');
			}
		}
		const invisible = await square({ inputA: constantShaderInput('color', [4, 1, -1, 0]), background, perspective: 0 });
		colorNear(pixelAt(invisible, 65, 32, 32), [0, 0, 0, 0], 'transparent card replaces background', 0);
		colorNear(pixelAt(invisible, 65, 0, 32), backgroundColor, 'background outside card');
		checks.push('subpixel coverage and transparent replacement');

		// 【陰影は色だけを変え、形とalphaを保つ】
		// 光源の強さによってカードが透明になったり、負値/HDRをclampすることを防ぐ。
		const unlit = await square({ background, shading: 0 });
		const lit = await square({ background, shading: 1 });
		colorNear(pixelAt(lit, 65, 32, 32), colorA.map((value, channel) => channel === 3 ? value : value * (0.55 + 0.45 * Math.SQRT1_2)), 'normal lighting');
		for (let index = 3; index < lit.length; index += 4) near(lit[index], unlit[index], 'lighting preserves alpha', 0);
		colorNear(pixelAt(lit, 65, 0, 32), pixelAt(unlit, 65, 0, 32), 'background unlit');
		checks.push('shading preserves alpha and signed HDR');

		// 【細いカードに縮小した縞模様はちらつかず平均される】
		// 点参照では幅1pxの縞が全面白/黒へ化ける。奇数・偶数寸法と両面を試し、
		// 縮小レベルの端画素落ちやA/Bのcapture buffer共有も検出する。
		for (const size of [63, 64]) {
			const sample = createEffect(size, size);
			for (const flipDirection of ['right', 'top'] as const) {
				const pattern = textureInput(size, size, Array.from({ length: size * size }, (_, index) => {
					const value = (flipDirection === 'right' ? index % size : Math.floor(index / size)) % 2;
					return [value, value, value, 1];
				}).flat());
				for (const progress of [0.49, 0.495, 0.499, 0.501, 0.505, 0.51]) {
					const pixels = await sample({ inputA: pattern, inputB: pattern, flipDirection, progress: scalar(progress), perspective: 0, shading: 0 });
					const pixel = pixelAt(pixels, size, Math.floor(size / 2), Math.floor(size / 2));
					assert(pixel[3] > 0, 'narrow card still covers center');
					near(pixel[0] / pixel[3], Math.floor(size / 2) / size, 'filtered stripes', 0.06);
				}
			}
		}
		checks.push('minification of even and odd stripe textures');

		// 【全入力のテクスチャ化・局所進捗・背景の座標を維持する】
		// 進捗は出力位置、カードは材料位置で読む。両面を同じフレームに描画して
		// 通常の一様な進捗では通らないcapture経路と入力の差し替えを確認する。
		const local = createEffect(65, 33);
		const localValues = Array.from({ length: 65 * 33 }, (_, index) => index % 65 < 32 ? 0.25 : 0.75);
		const localProgress = textureInput(65, 33, localValues, true, 'nearest');
		const solidTextureA = textureInput(3, 5, Array.from({ length: 15 }, () => colorA).flat());
		const solidTextureB = textureInput(5, 3, Array.from({ length: 15 }, () => colorB).flat());
		const localPixels = await local({ inputA: solidTextureA, inputB: solidTextureB, progress: localProgress, background: coordinateTexture(65, 33), perspective: 0, shading: 0 });
		colorNear(pixelAt(localPixels, 65, 20, 16), colorA, 'local front');
		colorNear(pixelAt(localPixels, 65, 44, 16), colorB, 'local back');
		colorNear(pixelAt(localPixels, 65, 0, 16), [0.5 / 65, 0.5, 0.25, 1], 'stationary background');
		const backgroundTexture = coordinateTexture(65, 33);
		equal(await local({ background: backgroundTexture, progress: scalar(0.5) }), await local({ inputA: backgroundTexture, progress: scalar(0) }), 'midpoint background texture');
		checks.push('texture inputs local progress and background');

		// 【入力のFit/Wrap/Filterをカードに貼る段階で適用する】
		// 縮小画像を作る都合で接続設定を無視しない。端点と同じ画像を回転中にも用いる。
		assert(solidTextureA.kind === 'texture', 'test texture kind');
		if (solidTextureA.kind === 'texture') {
			const contained = { ...solidTextureA, sampling: { ...solidTextureA.sampling, fitMode: 'contain' as const, wrapMode: 'transparent' as const, filterMode: 'nearest' as const } };
			const pixels = await local({ inputA: contained, perspective: 0, shading: 0 });
			colorNear(pixelAt(pixels, 65, 32, 16), colorA, 'contained texture center');
			colorNear(pixelAt(pixels, 65, 18, 16), [0, 0, 0, 0], 'contained transparent margin');
		}
		checks.push('input sampling settings');

		// 【解像度や再生順序を変えても同じ幾何を使う】
		// captureの更新漏れや隠れた面の古い縮小画像を再利用しないことも確認する。
		const baseline = await render({ inputA: solidTextureA, progress: scalar(0.2) });
		await render({ inputA: solidTextureB, inputB: solidTextureA, progress: scalar(0.8) }, 5);
		await render({ progress: scalar(0.2) }, 8);
		equal(await render({ inputA: solidTextureA, progress: scalar(0.2) }, -3), baseline, 'history independent');
		const low = await render({ shading: 0 });
		const high = await createEffect(195, 99)({ shading: 0 });
		for (const [x, y] of [[0, 16], [20, 16], [32, 16], [45, 16]]) colorNear(pixelAt(high, 195, x * 3 + 1, y * 3 + 1), pixelAt(low, 65, x, y), 'resolution independent');
		for (const [width, height] of [[1, 1], [1, 17], [17, 1]]) {
			const sample = createEffect(width, height);
			for (const progress of [0.000001, 0.49999997, 0.50000006, 0.999999]) await sample({ inputA: solidTextureA, inputB: solidTextureB, progress: scalar(progress), perspective: 2 });
		}
		checks.push('resolution history and degenerate dimensions');

		let preview: string | null = null;
		if (includePreview) {
			// 手動QAも実GPUの出力を使う。非対称な文字と図形で裏面の向きが分かるようにする。
			const width = 240;
			const height = 160;
			const makeCard = (second: boolean) => {
				const canvas = new OffscreenCanvas(width, height);
				const context = canvas.getContext('2d')!;
				context.fillStyle = second ? '#143d66' : '#f7ead1'; context.fillRect(0, 0, width, height);
				context.fillStyle = second ? '#54dbca' : '#bc4134'; context.fillRect(12, 12, width - 24, 34);
				context.font = 'bold 22px sans-serif'; context.fillStyle = second ? '#143d66' : '#fff8e9';
				context.fillText(second ? 'CARD B' : 'CARD A', 24, 37);
				context.font = '18px sans-serif'; context.fillStyle = second ? '#ccf2ef' : '#403b31';
				context.fillText('1   2   3   4   5', 25, 82);
				context.fillText('6   7   8   9   0', 25, 112);
				context.fillRect(24, 132, 135, 3);
				const pixels = context.getImageData(0, 0, width, height).data;
				const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
				return textureInput(width, height, Array.from(pixels, (value, index) => index % 4 === 3 ? value / 255 : linear(value / 255)));
			};
			const inputA = makeCard(false);
			const inputB = makeCard(true);
			const sample = createEffect(width, height);
			const canvas = new OffscreenCanvas(width * 5, (height + 28) * 4);
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#24272c'; context.fillRect(0, 0, canvas.width, canvas.height);
			const srgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
			for (const [row, flipDirection] of directions.entries()) {
				for (const [column, progress] of [0, 0.25, 0.5, 0.75, 1].entries()) {
					const pixels = await sample({ inputA, inputB, flipDirection, background: constantShaderInput('color', [0.025, 0.03, 0.04, 1]), progress: scalar(progress) });
					const encoded = Uint8ClampedArray.from(pixels, (value, index) => 255 * (index % 4 === 3 ? value : srgb(Math.max(0, value))));
					context.putImageData(new ImageData(encoded, width, height), column * width, row * (height + 28) + 28);
					context.fillStyle = '#ffffff'; context.font = '13px sans-serif';
					context.fillText(`${flipDirection} / ${progress}`, column * width + 8, row * (height + 28) + 19);
				}
			}
			const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
			preview = btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''));
		}
		return { checks, preview };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
