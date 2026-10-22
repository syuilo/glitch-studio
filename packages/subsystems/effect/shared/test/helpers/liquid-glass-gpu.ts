import definition from '../../src/fx/liquidGlass/_def_.ts';
import implementation from '../../src/fx/liquidGlass/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const owned: { destroy(): void }[] = [];
	const effects: { dispose(): void }[] = [];
	const vertex = device.createShaderModule({ code: vertexCode });
	const readModule = device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn read(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` });
	const readPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: { module: readModule, targets: [{ format: 'rgba8unorm' }] } });
	async function validate() {
		const error = await device.popErrorScope();
		device.pushErrorScope('validation');
		if (error != null) throw new Error(error.message);
	}
	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(readPipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout: readPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(6);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Uint8Array(buffer.getMappedRange());
			const pixels = new Uint8ClampedArray(width * height * 4);
			for (let y = 0; y < height; y++) pixels.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
			return pixels;
		} finally { buffer.destroy(); target.destroy(); }
	}
	function createEffect(width: number, height: number, format: IntermediateTextureFormat = 'rgba8unorm', enable32bitDataTextures = false) {
		const resolution = { width, height };
		const wgpu = { device, intermediateTextureFormat: format, enable32bitDataTextures, defaultVertexShaderModule: vertex };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		owned.push(output);
		const effect = implementation.init({ wgpu, resolution, params: defaults, reportStatus: () => {}, fallbackTexture: output });
		effects.push(effect);
		return {
			async render(overrides: Partial<Parameters> = {}, time = 0) {
				const commandEncoder = device.createCommandEncoder();
				effect.render({ params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 16,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
					createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
					createComputePassEncoder: encoder => encoder.beginComputePass(),
					createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				device.queue.submit([commandEncoder.finish()]);
				await validate();
				return read(output);
			},
		};
	}
	function image(width: number, height: number, paint: (x: number, y: number) => readonly number[]): ShaderInput {
		const pixels = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(paint(x, y), (y * width + x) * 4);
		const texture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		owned.push(texture);
		device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 4 }, [width, height]);
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' });
	}
	const zeroMask = constantShaderInput('scalar', 0);
	const fullMask = constantShaderInput('scalar', 1);
	const black = constantShaderInput('color', [0, 0, 0, 1]);
	const opticalOnly = { highlightStrength: 0, tint: [1, 1, 1, 0] as const };
	const at = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
	const equalPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray, message: string) => assert(a.every((value, index) => value === b[index]), message);
	const closePixel = (a: number[], b: number[], tolerance: number, message: string) => assert(a.every((value, index) => Math.abs(value - b[index]) <= tolerance), `${message}: ${a} vs ${b}`);
	function circleInputs(width: number, height: number) {
		const scale = Math.min(width, height);
		return {
			background: image(width, height, (x, y) => [120 + (x + 0.5 - width / 2) / scale * 160, 120 + (y + 0.5 - height / 2) / scale * 160, 50, 255]),
			mask: image(width, height, (x, y) => [Math.max(0, Math.min(1, scale / 3 + 0.5 - Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2))) * 255, 0, 0, 255]),
		};
	}
	try {
		const width = 128;
		const height = 96;
		const effect = createEffect(width, height);
		const inputs = circleInputs(width, height);
		const settings = { ...inputs, ...opticalOnly };
		// 【空マスク・無効化・平面】エフェクト追加や各強度のゼロ指定だけで背景が変色しないことを確認する。
		const original = await effect.render({ background: inputs.background, mask: zeroMask });
		equalPixels(original, await effect.render({ ...settings, refractionStrength: 0 }), 'zero refraction changes background');
		equalPixels(original, await effect.render({ ...settings, surfaceHeight: 0 }), 'zero height changes background');
		equalPixels(original, await effect.render({ ...settings, bevelWidth: 0 }), 'zero bevel changes background');
		equalPixels(original, await effect.render({ ...settings, mask: fullMask }), 'uniform mask creates a screen boundary');
		checks.push('empty mask', 'zero refraction', 'zero height and bevel', 'uniform mask');

		// 【縁の拡大方向とマスク外の保持】左右・上下の法線が同じ向きに曲がったり、背景全体を変形しないことを確認する。
		const refracted = await effect.render(settings);
		assert(at(refracted, width, 34, 48)[0] > at(original, width, 34, 48)[0] + 1, 'left refraction points outward');
		assert(at(refracted, width, 93, 48)[0] < at(original, width, 93, 48)[0] - 1, 'right refraction points outward');
		assert(at(refracted, width, 64, 18)[1] > at(original, width, 64, 18)[1] + 1, 'top refraction points outward');
		assert(at(refracted, width, 64, 77)[1] < at(original, width, 64, 77)[1] - 1, 'bottom refraction points outward');
		closePixel(at(refracted, width, 64, 48), at(original, width, 64, 48), 0, 'flat center');
		closePixel(at(refracted, width, 10, 48), at(original, width, 10, 48), 0, 'outside mask');
		checks.push('XY refraction direction', 'flat center', 'mask exterior');

		// 【光源方向】XYの方向指定で光沢が移動し、+Yの指定が画面上側を照らすことを確認する。
		const maxRed = (pixels: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number) => {
			let maximum = 0;
			for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) maximum = Math.max(maximum, at(pixels, width, x, y)[0]);
			return maximum;
		};
		const rightLight = await effect.render({ ...inputs, background: black, tint: [0, 0, 0, 0], lightDirection: [1, 0], highlightStrength: 2 });
		assert(maxRed(rightLight, 84, 40, 97, 56) > maxRed(rightLight, 31, 40, 44, 56) + 5, 'horizontal highlight direction');
		const topLight = await effect.render({ ...inputs, background: black, tint: [0, 0, 0, 0], lightDirection: [0, 1], highlightStrength: 2 });
		assert(maxRed(topLight, 56, 15, 72, 28) > maxRed(topLight, 56, 68, 72, 81) + 5, 'vertical highlight direction');
		checks.push('directional highlights');

		// 【半透明背景と被膜の合成】背景・Tint・マスクをそれぞれ一度だけ乗算し、透明背景へ光沢を描けることを確認する。
		const coated = await effect.render({ background: constantShaderInput('color', [0.8, 0.4, 0.2, 0.5]), mask: constantShaderInput('scalar', 0.5), tint: [0.2, 0.4, 0.8, 0.5], highlightStrength: 0 });
		closePixel(at(coated, width, 64, 48), [89, 64, 70, 159], 1, 'premultiplied coating and coverage');
		const transparent = await effect.render({ ...settings, background: constantShaderInput('color', [0, 0, 0, 0]) });
		assert(transparent.every(value => value === 0), 'transparent refraction creates color or alpha');
		const reflected = await effect.render({ mask: inputs.mask, tint: [0, 0, 0, 0], highlightStrength: 2 });
		assert(reflected.some((value, index) => index % 4 === 3 && value > 0), 'highlights invisible over transparency');
		const alphaBackground = image(width, height, x => [x, 0, 0, x]);
		const alphaRefraction = await effect.render({ ...settings, background: alphaBackground });
		assert(at(alphaRefraction, width, 34, 48)[3] > 34, 'alpha does not refract');
		assert(alphaRefraction.every((value, index) => index % 4 !== 0 || value === alphaRefraction[index + 3]), 'refraction premultiplies twice');
		checks.push('partial mask coverage', 'premultiplied alpha', 'transparent reflection', 'refracted alpha');

		// 【穴のある形と入力更新】単純な外周だけを仮定せず、同じtextureの内容変更後に古い輪郭を残さないことを確認する。
		const ringMask = image(width, height, (x, y) => { const distance = Math.hypot(x + 0.5 - 64, y + 0.5 - 48); return [distance > 16 && distance < 32 ? 255 : 0, 0, 0, 255]; });
		const ring = await effect.render({ ...settings, mask: ringMask });
		closePixel(at(ring, width, 64, 48), at(original, width, 64, 48), 0, 'hole filled');
		assert(at(ring, width, 82, 48)[0] > at(original, width, 82, 48)[0], 'inner contour normal');
		if (ringMask.kind !== 'texture') throw new Error('Expected mask texture');
		device.queue.writeTexture({ texture: ringMask.texture }, new Uint8Array(width * height * 4), { bytesPerRow: width * 4 }, [width, height]);
		equalPixels(original, await effect.render({ ...settings, mask: ringMask }), 'stale boundary after texture update');
		equalPixels(refracted, await effect.render(settings, 123), 'render history or time changes result');
		checks.push('interior contour', 'in-place mask update', 'time and history independence');

		// 【異なる入力寸法とwrap】マスクの上下を反転せず、屈折後の背景参照にも接続のサンプリング設定を適用する。
		const smallMask = image(4, 3, (x, y) => [x < 2 && y === 0 ? 255 : 0, 0, 0, 255]);
		const fitted = await effect.render({ background: black, mask: smallMask, tint: [1, 0, 0, 1], highlightStrength: 0 });
		assert(at(fitted, width, 8, 8)[0] === 255 && at(fitted, width, 8, 88)[0] === 0 && at(fitted, width, 120, 8)[0] === 0, 'mask fit or Y orientation');
		if (inputs.background.kind !== 'texture') throw new Error('Expected background texture');
		const transparentWrap = await effect.render({ ...settings, background: { ...inputs.background, wrapMode: 'transparent' }, refractionStrength: -2 });
		const clampedWrap = await effect.render({ ...settings, background: { ...inputs.background, wrapMode: 'clamp' }, refractionStrength: -2 });
		assert(at(transparentWrap, width, 33, 48)[3] === 0 && at(clampedWrap, width, 33, 48)[3] === 255, 'background wrap ignored');
		checks.push('input resolution and orientation', 'background wrap');

		// 【縦横比・解像度】同じ等方座標の形が横長・縦長でも同じ幅の縁になり、解像度を上げても変位量を保つことを確認する。
		for (const [otherWidth, otherHeight] of [[192, 96], [96, 128]]) {
			const other = await createEffect(otherWidth, otherHeight).render({ ...circleInputs(otherWidth, otherHeight), ...opticalOnly });
			closePixel(at(other, otherWidth, otherWidth / 2 - 30, otherHeight / 2), at(refracted, width, 34, 48), 1, 'aspect ratio changes refraction');
		}
		const doubled = await createEffect(256, 192).render({ ...circleInputs(256, 192), ...opticalOnly });
		closePixel(at(doubled, 256, 68, 96), at(refracted, width, 34, 48), 2, 'resolution changes refraction');
		checks.push('aspect ratio independence', 'resolution independence');

		// 【出力形式・内部精度・極端な寸法】各精度設定でbindingを検証し、16bitで大きなseed座標が隣の輪郭に丸まらないことを確認する。
		for (const format of ['bgra8unorm', 'rgba16float'] as const) {
			const formatted = await createEffect(width, height, format).render(settings);
			closePixel(at(formatted, width, 34, 48), at(refracted, width, 34, 48), 1, `output format ${format}`);
		}
		if (supports32bit) {
			const precise = await createEffect(width, height, 'rgba8unorm', true).render(settings);
			closePixel(at(precise, width, 34, 48), at(refracted, width, 34, 48), 1, '32bit internal textures');
			checks.push('32bit internal textures');
		}
		const tiny = await createEffect(1, 1).render({ background: black, mask: fullMask, tint: [1, 0, 0, 0.5], highlightStrength: 0 });
		closePixel(at(tiny, 1, 0, 0), [128, 0, 0, 255], 1, 'one-pixel output');
		const wideMask = image(4096, 8, x => [x >= 1001 && x < 1009 || x >= 3001 && x < 3009 ? 255 : 0, 0, 0, 255]);
		const wide = await createEffect(4096, 8).render({ background: black, mask: wideMask, tint: [0, 0, 0, 0], bevelWidth: 1, surfaceHeight: 0.6, highlightStrength: 2, lightDirection: [1, 0] });
		for (let x = 0; x < 8; x++) closePixel(at(wide, 4096, 1001 + x, 4), at(wide, 4096, 3001 + x, 4), 0, 'large seed coordinates');
		checks.push('output formats', 'one-pixel output', 'large seed coordinates');

		// 【目視確認用のプレビュー】文字・角丸パネル・穴のある形を同じ背景上に置き、屈折と光沢の外観を確認できるようにする。
		const previewWidth = 640;
		const previewHeight = 400;
		const canvas = new OffscreenCanvas(previewWidth, previewHeight);
		const context = canvas.getContext('2d')!;
		const gradient = context.createLinearGradient(0, 0, previewWidth, previewHeight);
		gradient.addColorStop(0, '#164d9e'); gradient.addColorStop(0.45, '#9b54d8'); gradient.addColorStop(1, '#ef7e76');
		context.fillStyle = gradient; context.fillRect(0, 0, previewWidth, previewHeight);
		context.strokeStyle = '#ffffff55'; context.lineWidth = 1;
		for (let x = 0; x < previewWidth; x += 24) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, previewHeight); context.stroke(); }
		for (let y = 0; y < previewHeight; y += 24) { context.beginPath(); context.moveTo(0, y); context.lineTo(previewWidth, y); context.stroke(); }
		context.fillStyle = '#f9d95a'; context.beginPath(); context.arc(170, 130, 66, 0, Math.PI * 2); context.fill();
		context.fillStyle = '#4ce5df'; context.beginPath(); context.arc(470, 275, 90, 0, Math.PI * 2); context.fill();
		const backgroundPixels = context.getImageData(0, 0, previewWidth, previewHeight).data;
		const previewBackground = image(previewWidth, previewHeight, (x, y) => Array.from(backgroundPixels.subarray((y * previewWidth + x) * 4, (y * previewWidth + x) * 4 + 4)));
		context.clearRect(0, 0, previewWidth, previewHeight);
		context.fillStyle = 'white'; context.beginPath(); context.roundRect(50, 45, 360, 145, 44); context.fill();
		context.beginPath(); context.arc(500, 125, 66, 0, Math.PI * 2); context.arc(500, 125, 32, 0, Math.PI * 2, true); context.fill();
		context.font = 'bold 104px sans-serif'; context.fillText('GLASS', 100, 335);
		const maskPixels = context.getImageData(0, 0, previewWidth, previewHeight).data;
		const previewMask = image(previewWidth, previewHeight, (x, y) => [maskPixels[(y * previewWidth + x) * 4 + 3], 0, 0, 255]);
		const previewPixels = await createEffect(previewWidth, previewHeight).render({ background: previewBackground, mask: previewMask, bevelWidth: 0.05, surfaceHeight: 0.025, highlightStrength: 1.5 });
		context.putImageData(new ImageData(previewPixels, previewWidth, previewHeight), 0, 0);
		const png = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
		const preview = btoa(Array.from(png, byte => String.fromCharCode(byte)).join(''));
		await validate();
		return { checks, preview };
	} finally {
		for (const effect of effects) effect.dispose();
		for (const resource of owned) resource.destroy();
		device.destroy();
	}
}
