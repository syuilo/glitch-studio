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
			async render(overrides: Partial<Parameters> = {}, time = 0, timeDelta = 16) {
				const commandEncoder = device.createCommandEncoder();
				effect.render({ params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta,
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

		// 【追加機能を無効にした場合の保持】強度が0なら、時刻・seed・サンプル数の設定だけで従来の屈折を変えない。
		equalPixels(refracted, await effect.render({ ...settings, blurRadius: 0, blurSamples: 4, dispersion: 0, surfaceWavinessAmplitude: 0, surfaceWavinessScale: 0.1, surfaceWavinessSeed: 123, time: 7 }), 'disabled additions change refraction');
		checks.push('disabled blur dispersion and waviness');

		// 【背景だけのぼかし】高周波の背景を平均し、マスク外やガラス表面の光沢をぼかさないことを確認する。
		const checker = image(width, height, (x, y) => { const value = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 * 255; return [value, value, value, 255]; });
		const checkerSettings = { ...opticalOnly, background: checker, mask: inputs.mask, refractionStrength: 0 };
		const sharpChecker = await effect.render(checkerSettings);
		const blurredChecker = await effect.render({ ...checkerSettings, blurRadius: 0.12, blurSamples: 64 });
		let sharpContrast = 0;
		let blurredContrast = 0;
		for (let y = 34; y < 62; y++) for (let x = 50; x < 78; x++) {
			sharpContrast += Math.abs(at(sharpChecker, width, x, y)[0] - 127.5);
			blurredContrast += Math.abs(at(blurredChecker, width, x, y)[0] - 127.5);
		}
		assert(blurredContrast < sharpContrast * 0.45, 'blur does not reduce background contrast');
		closePixel(at(blurredChecker, width, 10, 48), at(sharpChecker, width, 10, 48), 0, 'blur changes mask exterior');
		const sharpHighlightsWithBlur = await effect.render({ ...inputs, background: black, tint: [0, 0, 0, 0], lightDirection: [1, 0], highlightStrength: 2, blurRadius: 0.12 });
		equalPixels(rightLight, sharpHighlightsWithBlur, 'blur softens surface highlights');
		const transparentRedEdge = image(width, height, x => x >= 64 ? [128, 0, 0, 128] : [0, 0, 0, 0]);
		const blurredAlpha = await effect.render({ ...opticalOnly, background: transparentRedEdge, mask: fullMask, refractionStrength: 0, blurRadius: 0.12, blurSamples: 64 });
		assert(at(blurredAlpha, width, 63, 48)[3] > 0 && at(blurredAlpha, width, 63, 48)[3] < 128, 'blur ignores transparent neighbors');
		assert(blurredAlpha.every((value, index) => index % 4 !== 0 || value === blurredAlpha[index + 3]), 'blur multiplies alpha twice');
		checks.push('background blur', 'sharp mask and highlights', 'premultiplied blur');

		// 【RGBごとの色分散と透明度】法線方向に色を分け、透明な境界でもαより大きい乗算済みRGBを生成しないことを確認する。
		const grayRamp = image(width, height, x => { const value = x / (width - 1) * 255; return [value, value, value, 255]; });
		const dispersed = await effect.render({ ...settings, background: grayRamp, dispersion: 1 });
		const dispersedLeft = at(dispersed, width, 33, 48);
		const dispersedRight = at(dispersed, width, 94, 48);
		assert(dispersedLeft[0] < dispersedLeft[1] && dispersedLeft[1] < dispersedLeft[2], `left dispersion direction: ${dispersedLeft}`);
		assert(dispersedRight[0] > dispersedRight[1] && dispersedRight[1] > dispersedRight[2], `right dispersion direction: ${dispersedRight}`);
		const combinedSettings = { ...settings, blurRadius: 0.06, blurSamples: 32, dispersion: 0.4, surfaceWavinessAmplitude: 0.01, surfaceWavinessScale: 0.25, surfaceWavinessSeed: 5, time: 1.25 };
		const combined = await effect.render(combinedSettings);
		closePixel(at(combined, width, 10, 48), at(original, width, 10, 48), 0, 'combined additions change mask exterior');
		const whiteAlphaBackground = image(width, height, x => [x, x, x, x]);
		const dispersedAlpha = await effect.render({ ...combinedSettings, background: whiteAlphaBackground });
		assert(dispersedAlpha.every((value, index) => index % 4 === 3 || value <= dispersedAlpha[index - index % 4 + 3]), 'dispersion produces RGB outside alpha coverage');
		const emptyWithAdditions = await effect.render({ ...combinedSettings, background: constantShaderInput('color', [0, 0, 0, 0]) });
		assert(emptyWithAdditions.every(value => value === 0), 'combined additions create color on transparent background');
		const constantWithAdditions = await effect.render({ ...combinedSettings, mask: fullMask, background: constantShaderInput('color', [0.8, 0.4, 0.2, 0.5]) });
		closePixel(at(constantWithAdditions, width, 64, 48), [102, 51, 26, 128], 1, 'combined additions change constant premultiplied color');
		checks.push('RGB dispersion direction', 'dispersed alpha coverage', 'combined additions on transparent and uniform inputs');

		// 【表面の揺らぎ・シーク・描画間隔】明示的なTimeだけで動き、同じ時刻へのシークやfpsの違いで結果を変えない。
		const wavinessSettings = { ...opticalOnly, background: inputs.background, mask: fullMask, refractionStrength: 0.25, surfaceWavinessAmplitude: 0.03, surfaceWavinessScale: 0.25, surfaceWavinessSpeed: 0.8, surfaceWavinessSeed: 5, time: 0.75 };
		const wavy = await effect.render(wavinessSettings);
		const laterWaviness = await effect.render({ ...wavinessSettings, time: 1.75 });
		assert(wavy.some((value, index) => value !== original[index]), 'waviness does not affect flat surface refraction');
		assert(wavy.some((value, index) => value !== laterWaviness[index]), 'explicit time does not animate waviness');
		equalPixels(wavy, await effect.render(wavinessSettings, 999, 1000 / 30), 'waviness depends on context time or frame interval');
		await effect.render({ ...wavinessSettings, time: 0.25 });
		equalPixels(wavy, await effect.render(wavinessSettings, 1, 1000 / 120), 'waviness depends on seeking order');
		equalPixels(wavy, await effect.render({ ...wavinessSettings, time: -0.75, surfaceWavinessSpeed: -0.8 }), 'negative speed does not reverse time');
		const changedSeedWaviness = await effect.render({ ...wavinessSettings, surfaceWavinessSeed: 6 });
		assert(wavy.some((value, index) => value !== changedSeedWaviness[index]), 'seed does not change waviness');
		const scaledWaviness = await effect.render({ ...wavinessSettings, surfaceWavinessScale: 0.5 });
		assert(wavy.some((value, index) => value !== scaledWaviness[index]), 'scale does not change waviness');
		const stillWaviness = await effect.render({ ...wavinessSettings, surfaceWavinessSpeed: 0 });
		equalPixels(stillWaviness, await effect.render({ ...wavinessSettings, surfaceWavinessSpeed: 0, time: 42 }), 'zero speed does not freeze waviness');
		equalPixels(original, await effect.render({ ...wavinessSettings, surfaceWavinessAmplitude: 0 }), 'zero amplitude leaves stale waviness');
		checks.push('surface waviness', 'explicit time animation', 'fps and seeking independence', 'reverse and zero speed', 'waviness seed and scale');

		// 【縦横比・解像度】同じ等方座標の形が横長・縦長でも同じ幅の縁になり、解像度を上げても変位量を保つことを確認する。
		for (const [otherWidth, otherHeight] of [[192, 96], [96, 128]]) {
			const otherEffect = createEffect(otherWidth, otherHeight);
			const otherInputs = circleInputs(otherWidth, otherHeight);
			const other = await otherEffect.render({ ...otherInputs, ...opticalOnly });
			closePixel(at(other, otherWidth, otherWidth / 2 - 30, otherHeight / 2), at(refracted, width, 34, 48), 1, 'aspect ratio changes refraction');
			const otherCombined = await otherEffect.render({ ...combinedSettings, ...otherInputs });
			closePixel(at(otherCombined, otherWidth, otherWidth / 2 - 30, otherHeight / 2), at(combined, width, 34, 48), 2, 'aspect ratio changes blur dispersion or waviness');
		}
		const doubledEffect = createEffect(256, 192);
		const doubledInputs = circleInputs(256, 192);
		const doubled = await doubledEffect.render({ ...doubledInputs, ...opticalOnly });
		closePixel(at(doubled, 256, 68, 96), at(refracted, width, 34, 48), 2, 'resolution changes refraction');
		const doubledCombined = await doubledEffect.render({ ...combinedSettings, ...doubledInputs });
		closePixel(at(doubledCombined, 256, 68, 96), at(combined, width, 34, 48), 3, 'resolution changes blur dispersion or waviness');
		checks.push('aspect ratio independence', 'resolution independence');

		// 【出力形式・内部精度・極端な寸法】各精度設定でbindingを検証し、16bitで大きなseed座標が隣の輪郭に丸まらないことを確認する。
		for (const format of ['bgra8unorm', 'rgba16float'] as const) {
			const formattedEffect = createEffect(width, height, format);
			const formatted = await formattedEffect.render(settings);
			closePixel(at(formatted, width, 34, 48), at(refracted, width, 34, 48), 1, `output format ${format}`);
			const formattedCombined = await formattedEffect.render(combinedSettings);
			closePixel(at(formattedCombined, width, 34, 48), at(combined, width, 34, 48), 1, `combined additions output format ${format}`);
		}
		if (supports32bit) {
			const preciseEffect = createEffect(width, height, 'rgba8unorm', true);
			const precise = await preciseEffect.render(settings);
			closePixel(at(precise, width, 34, 48), at(refracted, width, 34, 48), 1, '32bit internal textures');
			const preciseCombined = await preciseEffect.render(combinedSettings);
			closePixel(at(preciseCombined, width, 34, 48), at(combined, width, 34, 48), 1, 'combined additions 32bit internal textures');
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
		const previewEffect = createEffect(previewWidth, previewHeight);
		const previewSettings = { background: previewBackground, mask: previewMask, bevelWidth: 0.05, surfaceHeight: 0.025, highlightStrength: 1.5 };
		const previewPixels = await previewEffect.render(previewSettings);
		const extendedPreviewPixels = await previewEffect.render({ ...previewSettings, blurRadius: 0.025, blurSamples: 64, dispersion: 0.5, surfaceWavinessAmplitude: 0.012, surfaceWavinessScale: 0.25, surfaceWavinessSeed: 11, time: 2 });
		const comparison = new OffscreenCanvas(previewWidth * 2, previewHeight + 40);
		const comparisonContext = comparison.getContext('2d')!;
		comparisonContext.fillStyle = '#111827'; comparisonContext.fillRect(0, 0, comparison.width, comparison.height);
		comparisonContext.fillStyle = 'white'; comparisonContext.font = '18px sans-serif';
		comparisonContext.fillText('Refraction + Highlights', 16, 27);
		comparisonContext.fillText('Blur + Dispersion + Waviness', previewWidth + 16, 27);
		comparisonContext.putImageData(new ImageData(previewPixels, previewWidth, previewHeight), 0, 40);
		comparisonContext.putImageData(new ImageData(extendedPreviewPixels, previewWidth, previewHeight), previewWidth, 40);
		const png = new Uint8Array(await (await comparison.convertToBlob()).arrayBuffer());
		const preview = btoa(Array.from(png, byte => String.fromCharCode(byte)).join(''));
		await validate();
		return { checks, preview };
	} finally {
		for (const effect of effects) effect.dispose();
		for (const resource of owned) resource.destroy();
		device.destroy();
	}
}
