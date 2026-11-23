import { linearSrgbToSrgb } from '@gs/shared/color-space.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { NativeParameterValues } from '../../src/multipass.ts';
import definition from '../../src/fx/gyroidBubbles/_def_.ts';
import implementation from '../../src/fx/gyroidBubbles/_impl_.ts';
import { nativeEffectProbe } from './native-effect-probe.ts';

type Parameters = NativeParameterValues<typeof definition.paramDefs>;
const probe = nativeEffectProbe(definition, implementation);

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}

function near(actual: number, expected: number, label: string, tolerance = 0.002) {
	assert(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`);
}

export async function run(includePreview = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const wgpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
	const disposeRenderers: (() => void)[] = [];

	function createRenderer(width: number, height: number) {
		const resolution = { width, height };
		const output = probe.createTexture('output', { wgpu, resolution });
		assert(output.format === 'rgba16float', 'image format');
		const instance = probe.place(wgpu, resolution);
		const bytesPerRow = Math.ceil(width * 8 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		disposeRenderers.push(() => { instance.dispose(); output.destroy(); buffer.destroy(); });
		return async (params: Partial<Parameters> = {}, time = 0) => {
			device.pushErrorScope('validation');
			const commandEncoder = device.createCommandEncoder();
			await instance.draw({ params, outputs: { output }, commandEncoder, time });
			commandEncoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
			const error = await device.popErrorScope();
			if (error != null) throw new Error(error.message);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float16Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) {
				const start = row * bytesPerRow / 2;
				pixels.set(padded.subarray(start, start + width * 4), row * width * 4);
			}
			buffer.unmap();
			assert(pixels.every(Number.isFinite), 'finite pixels');
			return pixels;
		};
	}

	try {
		const render = createRenderer(65, 65);
		const renderCenter = createRenderer(1, 1);
		const baseline = await render();
		assert(baseline.some((value, index) => index % 4 !== 3 && value > 0.2), 'visible default bubbles');
		assert(baseline.every((value, index) => index % 4 === 3 ? value === 1 : value >= 0 && value <= 1), 'opaque soft shoulder');

		// 【球の間に隙間があっても発光する膜がつながる】
		// Time=0で手前の2球の間にある同じ世界位置を照合する。Glow Widthを隙間より十分狭め、
		// 単に光の裾が重なった場合と、smooth unionで表面が現れた場合を区別する。
		const pair = { count: 2, surfaceDeformation: 0, glowWidth: 0.004, cameraPosition: [0.0049, 0.15] as [number, number] };
		assert((await renderCenter({ ...pair, mergeWidth: 0 }))[0] === 0, 'open gap between unblended bubbles');
		assert((await renderCenter(pair))[0] > 0.03, 'luminous neck in the gap');
		assert((await renderCenter({ ...pair, time: 4.5 }))[0] === 0, 'separated bubbles lose the neck as they move apart');

		// 【Spacingは泡の中心間距離だけを変え、個数と半径を保つ】
		// 融合と変形を無効にし、2個それぞれの中心付近と輪郭付近を移動量だけずらしたレイで照合する。
		const spacedPair = { ...pair, mergeWidth: 0, colorFrequency: 0 };
		assert((await renderCenter({ ...spacedPair, spacing: 0.5 }))[0] > 0.03, 'smaller spacing closes the gap');
		assert((await renderCenter({ ...pair, spacing: 2 }))[0] === 0, 'larger spacing separates blended bubbles');
		for (const side of [-1, 1]) {
			const centerX = side * 0.15;
			assert((await renderCenter({ ...spacedPair, spacing: 2, cameraPosition: [centerX, 0.15] }))[0] === 0, 'bubble leaves its original position');
			for (const [offset, isVisible] of [[0, true], [0.128, true], [0.15, false]] as const) {
				const reference = await renderCenter({ ...spacedPair, cameraPosition: [centerX, 0.15 + offset] });
				const spread = await renderCenter({ ...spacedPair, spacing: 2, cameraPosition: [2 * centerX, 0.15 + offset] });
				assert((reference[0] > 0.03) === isVisible, 'ray tests the expected side of the reference rim');
				near(spread[0], reference[0], 'same bubble radius at its new position');
			}
		}

		// 【変形量ゼロでは真球に戻り、細かさを変えても形が変わらない】
		// 単独の泡の中心へ視点を合わせ、同じ半径上の水平・垂直の画素と輪郭の発光を照合する。
		const single = { count: 1, cameraPosition: [-0.15, 0.15] as [number, number], zoom: 1, colorFrequency: 0, surfaceDeformation: 0 };
		const sphere = await render(single);
		assert((await render({ ...single, spacing: 0 })).every((value, index) => value === sphere[index]), 'spacing has no effect on a single bubble');
		const centerIndex = (32 * 65 + 32) * 4;
		const rimIndex = centerIndex + 9 * 4;
		assert(sphere[rimIndex] > sphere[centerIndex] + 0.05, 'the rim glows more brightly than the center');
		for (let distance = 0; distance <= 14; distance++) {
			near(sphere[centerIndex + distance * 4], sphere[centerIndex + distance * 65 * 4], 'round silhouette');
		}
		assert((await render({ ...single, detailFrequency: 4 })).every((value, index) => value === sphere[index]), 'detail frequency has no effect on a sphere');
		const deformed = await render({ ...single, surfaceDeformation: 1 });
		assert(deformed.some((value, index) => Math.abs(value - sphere[index]) > 0.07), 'deformation changes the visible shell');
		assert((await render({ ...single, surfaceDeformation: 1, detailFrequency: 4 })).some((value, index) => Math.abs(value - deformed[index]) > 0.07), 'detail frequency changes a deformed shell');

		// 【前後の膜へ別々にレイが届き、描画距離で奥の膜を切れる】
		// 真球の中心を通る光は、同じ色の前面と背面の寄与を等しく受ける。
		const fullRay = await renderCenter({ ...single, toneMapping: 'hdr' });
		const frontOnly = await renderCenter({ ...single, toneMapping: 'hdr', maximumTraceDistance: 0.78 });
		const inside = await renderCenter({ ...single, toneMapping: 'hdr', cameraZ: 0.015 });
		assert(frontOnly[0] > 0.1, 'visible front shell');
		near(fullRay[0], frontOnly[0] * 2, 'both faces emit', 0.015);
		near(inside[0], frontOnly[0], 'camera inside sees the back shell', 0.015);
		assert((await renderCenter({ ...single, surfaceDeformation: 1, detailFrequency: 4, glowWidth: 0.001, maximumSteps: 1024 }))[0] > 0.01, 'narrow deformed shell stays visible');
		for (const limits of [{ maximumTraceDistance: 0 }, { glowWidth: 0 }, { glowStrength: 0 }]) {
			assert((await renderCenter({ ...single, ...limits, compositing: 'emission' })).every(value => value === 0), 'disabled emission is transparent black');
		}

		// 【画角、Timeのシーク、ループが解像度や呼び出し間隔から独立する】
		// 長辺が同じ横長の画像は中央部分と一致し、縦長でも正方形と同じ位置の空間を参照する。
		const wide = await createRenderer(65, 39)();
		const tall = await createRenderer(39, 65)();
		const larger = await createRenderer(195, 195)();
		for (let y = 0; y < 39; y += 4) for (let x = 0; x < 39; x += 4) {
			near(wide[(y * 65 + x) * 4], baseline[((y + 13) * 65 + x) * 4], 'wide image is a crop');
			near(tall[(y * 39 + x) * 4], baseline[(y * 65 + x + 13) * 4], 'tall image is a crop');
			near(larger[((y * 3 + 1) * 195 + x * 3 + 1) * 4], baseline[(y * 65 + x) * 4], 'larger image keeps framing');
		}
		const animated = await render({ time: 4.5 });
		assert(animated.some((value, index) => Math.abs(value - baseline[index]) > 0.1), 'time moves the bubbles');
		for (const time of [4.5, 22.5, -13.5]) {
			assert((await render({ time }, 100)).every((value, index) => value === animated[index]), 'same loop phase restores the frame');
		}

		// 【HDRで負値と1超の光量を保ち、Emissionのalphaを0にする】
		// 単一stopの色から発光のRGB比とalphaの一回だけの乗算を照合する。
		const ramp: ColorRamp = { ...definition.paramDefs.ramp.defaultValue, stops: [{ id: 'tint', position: 0, color: [4, -1, 0.5, 0.5] }] };
		const rampParams = { ...single, colorMode: 'colorRamp', ramp, toneMapping: 'hdr', glowStrength: 2 } as const;
		const opaque = await renderCenter(rampParams);
		const emission = await renderCenter({ ...rampParams, compositing: 'emission', exposure: 1 });
		const fullAlpha = await renderCenter({ ...rampParams, ramp: { ...ramp, stops: [{ ...ramp.stops[0], color: [4, -1, 0.5, 1] }] } });
		assert(opaque[0] > 1 && opaque[1] < 0 && opaque[3] === 1 && emission[3] === 0, 'signed HDR and alpha modes');
		near(opaque[1], -opaque[0] * 0.25, 'ramp color ratio');
		for (let channel = 0; channel < 3; channel++) {
			near(emission[channel], opaque[channel] * 2, 'one EV doubles RGB in emission mode');
			near(fullAlpha[channel], opaque[channel] * 2, 'ramp alpha is applied once');
		}
		assert((await render({ count: 12, surfaceDeformation: 1, detailFrequency: 4, glowWidth: 0.004, maximumSteps: 1024 })).some((value, index) => index % 4 !== 3 && value > 0.05), 'all orbit pairs render at the trace budget limit');

		let preview: string | null = null;
		if (includePreview) {
			const width = 640;
			const height = 360;
			const pixels = await createRenderer(width, height)();
			const image = new ImageData(width, height);
			for (let index = 0; index < pixels.length; index += 4) {
				const color = linearSrgbToSrgb([pixels[index], pixels[index + 1], pixels[index + 2], 1]);
				image.data.set(color.map(value => value * 255), index);
			}
			const canvas = new OffscreenCanvas(width, height);
			canvas.getContext('2d')!.putImageData(image, 0, 0);
			preview = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()).toBase64();
		}
		return { passed: true, preview };
	} finally {
		for (const dispose of disposeRenderers) dispose();
		device.destroy();
	}
}
