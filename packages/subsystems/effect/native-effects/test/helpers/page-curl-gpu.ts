import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/pageCurl/_def_.ts';
import implementationNative from '../../src/fx/pageCurl/_impl_.ts';
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
		progress: scalar(0.5), startEdge: 'right', curlRadius: 0.08, sizeReference: 'longSide',
		backMode: 'source', backColor: constantShaderInput('color', [0.92, 0.90, 0.84, 1]),
		backInput: constantShaderInput('color', [0, 0, 0, 0]),
		shadowOpacity: 0.35, shadowSoftness: 0.02, shading: 0.6,
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
	const canonicalPixel = (width: number, height: number, startEdge: Parameters['startEdge'], fraction: number) => {
		const x = startEdge === 'right' ? Math.round(fraction * width - 0.5)
			: startEdge === 'left' ? Math.round((1 - fraction) * width - 0.5) : (width - 1) / 2;
		const y = startEdge === 'bottom' ? Math.round(fraction * height - 0.5)
			: startEdge === 'top' ? Math.round((1 - fraction) * height - 0.5) : (height - 1) / 2;
		const coordinate = startEdge === 'right' ? (x + 0.5) / width
			: startEdge === 'left' ? 1 - (x + 0.5) / width
				: startEdge === 'top' ? 1 - (y + 0.5) / height : (y + 0.5) / height;
		return { x, y, coordinate };
	};
	const materialColor = (startEdge: Parameters['startEdge'], fraction: number) => [
		startEdge === 'right' ? fraction : startEdge === 'left' ? 1 - fraction : 0.5,
		startEdge === 'top' ? fraction : startEdge === 'bottom' ? 1 - fraction : 0.5,
		0.25, 1,
	];

	try {
		// 【全方向・裏面モードで完全なA/Bへ連続してつながる】
		// 端点だけ元画像へ置換する実装では、影や裏面が最後のフレームで消えてしまう。
		// 半透明・HDR・負値と極小/大半径を同時に使い、その直前も元画像へ近づくことを確認する。
		const render = createEffect(65, 33);
		for (const startEdge of ['right', 'left', 'top', 'bottom'] as const) {
			for (const backMode of ['source', 'color', 'input'] as const) {
				for (const curlRadius of [0, 0.08, 2]) {
					for (const progress of [-1, 0, 0.000001, 0.999999, 1, 2]) {
						const pixels = await render({ startEdge, backMode, curlRadius, progress: scalar(progress), shadowOpacity: 1, shadowSoftness: 0.4, shading: 1 });
						const expected = progress < 0.5 ? colorA : colorB;
						pixels.forEach((value, index) => near(value, expected[index % 4], 'continuous endpoint', progress <= 0 || progress >= 1 ? 0 : 0.005));
					}
				}
			}
		}
		checks.push('all edge mode radius endpoints');

		// 【元画像の細部も端点で保存する】
		// 定数色だけでは参照位置の飛びを検出できないため、座標を符号化した画像を比較する。
		for (const [width, height] of [[33, 17], [17, 33]]) {
			const sample = createEffect(width, height);
			const inputA = coordinateTexture(width, height);
			const inputB = coordinateTexture(height, width);
			for (const startEdge of ['right', 'top'] as const) {
				for (const endpoint of [0, 1]) {
					const exact = await sample({ inputA, inputB, startEdge, progress: scalar(endpoint) });
					const close = await sample({ inputA, inputB, startEdge, progress: scalar(endpoint === 0 ? 0.000001 : 0.999999) });
					equal(close, exact, 'textured endpoint');
				}
			}
		}
		checks.push('textured continuous endpoints');

		// 【表面・曲面裏面・平面裏面・Bの前後関係と反転軸】
		// 半径0.08、進捗0.5では折り目0.46、円筒の外縁0.54となる。
		// 裏返った材料座標を持つ既知の画像で、単なるWipeや全方向同じ左右反転を検出する。
		for (const [width, height] of [[65, 33], [33, 65]]) {
			const sample = createEffect(width, height);
			const inputA = coordinateTexture(width, height);
			const backInput = coordinateTexture(width, height);
			for (const startEdge of ['right', 'left', 'top', 'bottom'] as const) {
				const pageLength = (startEdge === 'left' || startEdge === 'right' ? width : height) / Math.max(width, height);
				const pixels = await sample({ inputA, backInput, backMode: 'input', startEdge, curlRadius: 0.08 * pageLength, shading: 0, shadowOpacity: 0 });
				for (const fraction of [0.05, 0.3, 0.5, 0.9]) {
					const { x, y, coordinate } = canonicalPixel(width, height, startEdge, fraction);
					if (fraction === 0.9) {
						colorNear(pixelAt(pixels, width, x, y), colorB, 'revealed background');
					} else {
						const material = fraction === 0.05 ? coordinate
							: fraction === 0.3 ? 0.92 + Math.PI * 0.08 - coordinate
								: 0.46 + 0.08 * (Math.PI - Math.asin((coordinate - 0.46) / 0.08));
						colorNear(pixelAt(pixels, width, x, y), materialColor(startEdge, material), 'visible material coordinate');
					}
				}
			}
		}
		checks.push('four edges occlusion and material mirroring');

		// 【裏返る前の円筒表面と法線の明暗】
		// 30度曲がった紙の投影位置へ折り目を合わせ、弧長r*thetaから元の材料位置を求める。
		// 表面を動かさない近似や、曲面の明暗でalphaまで変える誤りを検出する。
		const frontSample = createEffect(101, 51);
		const inputPattern = coordinateTexture(101, 51);
		const coordinate = 85.5 / 101;
		const angle = Math.PI / 6;
		const crease = coordinate - 0.12 * Math.sin(angle);
		const progress = (1 - crease) / 1.12;
		const parameters: Partial<Parameters> = { inputA: inputPattern, curlRadius: 0.12, progress: scalar(progress), shadowOpacity: 0, shading: 0 };
		const unlit = await frontSample(parameters);
		const expectedFront = [crease + 0.12 * angle, 0.5, 0.25, 1];
		colorNear(pixelAt(unlit, 101, 85, 25), expectedFront, 'curved front material');
		const lit = await frontSample({ ...parameters, shading: 1 });
		colorNear(pixelAt(lit, 101, 85, 25), expectedFront.map((value, channel) => channel === 3 ? value : value * (0.55 + 0.45 * Math.cos(angle))), 'curved front lighting');
		checks.push('curved front and normal shading');

		// 【裏面の3モードと紙色のalpha】
		// 表面流用ではAの透明度を保ち、単色・別画像では選択した裏面自体の透明度を使う。
		const square = createEffect(65, 65);
		const paper = constantShaderInput('color', [0.4, 0.6, 0.8, 0.5]);
		const back = constantShaderInput('color', [-2, 0.25, 3, 0.3]);
		for (const backMode of ['source', 'color', 'input'] as const) {
			const pixels = await square({ backMode, backColor: paper, backInput: back, shading: 0, shadowOpacity: 0 });
			const expected = backMode === 'source' ? [2 * 0.65 + 0.2 * 0.35, -1 * 0.65 + 0.3 * 0.35, 0.5 * 0.65 + 0.4 * 0.35, 0.5]
				: backMode === 'color' ? [0.2, 0.3, 0.4, 0.5] : [-0.6, 0.075, 0.9, 0.3];
			colorNear(pixelAt(pixels, 65, 19, 32), expected, 'back mode');
		}
		const untinted = await square({ backColor: constantShaderInput('color', [9, -4, 3, 0]), shading: 0, shadowOpacity: 0 });
		colorNear(pixelAt(untinted, 65, 19, 32), colorA, 'zero paper alpha preserves print');
		checks.push('back modes HDR alpha and tint');

		// 【円筒の外縁は表裏を二重に数えない】
		// x=0.54の輪郭は65pxの35番画素を10%覆う。表面と裏面を順にmixすると
		// 19%になってしまうため、独立した面積の期待値と比較する。
		const antialias = await square({
			inputA: constantShaderInput('color', [1, 0, 0, 1]), inputB: constantShaderInput('color', [0, 0, 1, 0.25]),
			backMode: 'color', backColor: constantShaderInput('color', [1, 0, 0, 1]), shading: 0, shadowOpacity: 0,
		});
		colorNear(pixelAt(antialias, 65, 35, 32), [0.1, 0, 0.225, 0.325], 'exclusive silhouette coverage');
		checks.push('single coverage antialias at silhouette');

		// 【影はBのalphaを変えず、透明なAは影を落とさない】
		// 紙を消す処理と影の設定を混同せず、Shadow Softnessを変えても紙の形は同じにする。
		const noShadow = await square({ shadowOpacity: 0 });
		const shadow = await square({ shadowOpacity: 1, shadowSoftness: 0.1 });
		const backgroundIndex = (32 * 65 + 37) * 4;
		assert(shadow[backgroundIndex] > noShadow[backgroundIndex] && shadow[backgroundIndex + 1] < noShadow[backgroundIndex + 1], 'shadow reduces signed RGB magnitude');
		for (let index = 3; index < shadow.length; index += 4) near(shadow[index], noShadow[index], 'shadow preserves alpha', 0);
		const invisibleA = constantShaderInput('color', [9, -4, 3, 0]);
		equal(await square({ inputA: invisibleA, shadowOpacity: 1 }), await square({ inputA: invisibleA, shadowOpacity: 0 }), 'transparent A casts no shadow');
		const invisibleB = await square({ inputB: constantShaderInput('color', [4, 9, -2, 0]), shadowOpacity: 1 });
		colorNear(pixelAt(invisibleB, 65, 50, 32), [0, 0, 0, 0], 'transparent B remains transparent', 0);
		const wideEndShadow = await square({ progress: scalar(0.999999), shadowSoftness: 8, shadowOpacity: 1 });
		wideEndShadow.forEach((value, index) => near(value, colorB[index % 4], 'wide shadow fades before endpoint'));
		checks.push('alpha aware shadow and continuous fade');

		// 【裏面色と進捗も通常のテクスチャ入力を扱う】
		// 誤った入力名やuniform専用分岐を通さず、色・画像・scalarでpipelineを切り替える。
		const texturedBackColor = await square({ backMode: 'color', backColor: coordinateTexture(65, 65), shading: 0, shadowOpacity: 0 });
		colorNear(pixelAt(texturedBackColor, 65, 19, 32), [0.92 + Math.PI * 0.08 - 0.3, 0.5, 0.25, 1], 'back color texture follows material');
		const local = createEffect(8, 4);
		const values = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? 0 : 1);
		const localProgress = await local({ progress: textureInput(8, 4, values, true, 'nearest') });
		localProgress.forEach((value, index) => near(value, (values[Math.floor(index / 4)] === 0 ? colorA : colorB)[index % 4], 'local progress endpoints', 0));
		checks.push('texture inputs and local progress');

		// 【Size Reference・解像度・時刻に対する不変性】
		// 半径と影幅だけを換算し、紙の縦横の単位や再生方向に状態を持ち込まない。
		const reference = await render({ curlRadius: 0.08 * 33 / 65, shadowSoftness: 0.02 * 33 / 65 });
		equal(await render({ sizeReference: 'height' }), reference, 'size reference');
		const baseline = await square({ progress: scalar(0.7) });
		await square({ progress: scalar(0.2) }, 12);
		equal(await square({ progress: scalar(0.7) }, -3), baseline, 'scrubbing independent');
		const low = await render({ shading: 0, shadowOpacity: 0 });
		const high = await createEffect(195, 99)({ shading: 0, shadowOpacity: 0 });
		for (const [x, y] of [[3, 16], [19, 16], [32, 16], [58, 16]]) colorNear(pixelAt(high, 195, x * 3 + 1, y * 3 + 1), pixelAt(low, 65, x, y), 'resolution independent');
		for (const curlRadius of [0, 0.000001, 8]) {
			for (const progress of [0.1, 0.5, 0.9]) await square({ curlRadius, progress: scalar(progress) });
		}
		checks.push('size reference resolution history and radius extremes');

		let preview: string | null = null;
		if (includePreview) {
			// 手動QA用。数値テストと同じGPU出力を使い、見た目だけ別の実装へ置き換えない。
			const width = 240;
			const height = 160;
			const makePage = (second: boolean) => {
				const canvas = new OffscreenCanvas(width, height);
				const context = canvas.getContext('2d')!;
				context.fillStyle = second ? '#143d66' : '#f7ead1'; context.fillRect(0, 0, width, height);
				context.fillStyle = second ? '#54dbca' : '#bc4134'; context.fillRect(12, 12, width - 24, 34);
				context.font = 'bold 22px sans-serif'; context.fillStyle = second ? '#143d66' : '#fff8e9';
				context.fillText(second ? 'PAGE B' : 'PAGE A', 24, 37);
				context.font = '18px sans-serif'; context.fillStyle = second ? '#ccf2ef' : '#403b31';
				context.fillText('1   2   3   4   5', 25, 82);
				context.fillText('6   7   8   9   0', 25, 112);
				context.fillRect(24, 132, 135, 3);
				const pixels = context.getImageData(0, 0, width, height).data;
				const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
				return textureInput(width, height, Array.from(pixels, (value, index) => index % 4 === 3 ? value / 255 : linear(value / 255)));
			};
			const inputA = makePage(false);
			const inputB = makePage(true);
			const sample = createEffect(width, height);
			const canvas = new OffscreenCanvas(width * 5, (height + 28) * 4);
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#24272c'; context.fillRect(0, 0, canvas.width, canvas.height);
			const srgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
			for (const [row, startEdge] of (['right', 'left', 'top', 'bottom'] as const).entries()) {
				for (const [column, progress] of [0, 0.25, 0.5, 0.75, 1].entries()) {
					const pixels = await sample({ inputA, inputB, startEdge, progress: scalar(progress) });
					const encoded = Uint8ClampedArray.from(pixels, (value, index) => 255 * (index % 4 === 3 ? value : srgb(Math.max(0, value))));
					context.putImageData(new ImageData(encoded, width, height), column * width, row * (height + 28) + 28);
					context.fillStyle = '#ffffff'; context.font = '13px sans-serif';
					context.fillText(`${startEdge} / ${progress}`, column * width + 8, row * (height + 28) + 19);
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

