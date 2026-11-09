import { TimelinePreviewFrameCache } from '../../src/timeline-preview-frame-cache.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { linearChannelToSrgb, srgbChannelToLinear } from '@gs/shared/color-space.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const vertex = device.createShaderModule({ code: vertexCode });
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const pipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
	return textureLoad(image, vec2i(pixel.xy), 0);
}` }), targets: [{ format: 'rgba32float' }] }, primitive: { topology: 'triangle-list' },
	});

	async function read(source: GPUTexture) {
		const target = device.createTexture({ size: [2, 2], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: source.createView() }] }));
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: 256 }, [2, 2]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const data = new Float32Array(buffer.getMappedRange());
			return [...data.slice(0, 8), ...data.slice(64, 72)];
		} finally { buffer.destroy(); target.destroy(); }
	}

	const checks: string[] = [];
	try {
		for (const precision of ['original', '8bit'] as const) for (const format of ['rgba8unorm', 'bgra8unorm', 'rgba16float', 'rgba32float', 'r16float', 'rg16float', 'r32float', 'rg32float'] as const) {
			device.pushErrorScope('validation');
			const cache = new TimelinePreviewFrameCache<null>(device, vertex, 1024, precision);
			const source = device.createTexture({ size: [2, 2], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
			try {
				// 【暗部・半透明・HDR・負値・alpha=0の発光を保存方針に応じて保持または量子化する】
				// linearのまま8bitへ丸めたり、sRGB変換の前後に余分なalpha乗除算を加える実装を検出する。
				const pixels = format.endsWith('16float') ? new Uint16Array([0x1400, 0x3400, 0x3800, 0x3800, 0x4000, 0xb800, 0x3800, 0x3400, 0x3400, 0x3c00, 0x3800, 0, 0x3800, 0x3800, 0x3800, 0x3c00])
					: format.endsWith('32float') ? new Float32Array([1 / 1024, 0.25, 0.5, 0.5, 2, -0.5, 0.5, 0.25, 0.25, 1, 0.5, 0, 0.5, 0.5, 0.5, 1])
						: new Uint8Array([64, 128, 0, 128, 255, 0, 128, 64, 0, 255, 128, 0, 128, 128, 128, 255]);
				device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: pixels.byteLength / 2 }, [2, 2]);
				const original = await read(source);
				const expected = original.map((value, index) => {
					if (precision === 'original') return value;
					const encoded = index % 4 === 3 ? value : linearChannelToSrgb(value);
					const quantized = Math.round(Math.max(0, Math.min(1, encoded)) * 255) / 255;
					return index % 4 === 3 ? quantized : srgbChannelToLinear(quantized);
				});
				const pixelsDiffer = (values: number[]) => values.some((value, index) => {
					if (precision === '8bit') {
						if (index % 4 === 3) {
							// UNORMのちょうど中間の丸め方向は固定せず、線形8bitの半段階までを許容する。
							return Math.abs(value - Math.max(0, Math.min(1, original[index]))) > 0.5 / 255 + 1e-6;
						}
						// 固定機能のsRGB変換はCPUの式と完全には一致しないため、保存値の1段階を許容する。
						// linear側で一律の許容差を広げると、暗部を誤ってlinearの8bitへ丸めても通ってしまう。
						return Math.abs(linearChannelToSrgb(value) - linearChannelToSrgb(expected[index])) > 1 / 255;
					}
					return Math.abs(value - expected[index]) > 1e-6;
				});
				const encoder = device.createCommandEncoder();
				const captured = cache.capture(encoder, source, null);
				if (captured == null) throw new Error('Frame was not captured');
				const destinationFormat = precision === '8bit' ? 'rgba8unorm-srgb' : format;
				if (captured.texture.format !== destinationFormat) throw new Error(`${precision}/${format}: unexpected cache format`);
				if (precision === '8bit' && captured.bytes !== 16) throw new Error('RGBA8 capacity must be four bytes per pixel');
				device.queue.submit([encoder.finish()]);
				await device.queue.onSubmittedWorkDone();
				cache.commit(0, captured);
				// 元の作業用画像を更新しても、以前のフレームの画素・alpha・HDR値は変化しない。
				device.queue.writeTexture({ texture: source }, new Uint8Array(pixels.byteLength), { bytesPerRow: pixels.byteLength / 2 }, [2, 2]);
				const saved = cache.get(0);
				if (saved == null) throw new Error('Cached frame disappeared');
				const actual = await read(saved.texture);
				if (pixelsDiffer(actual)) throw new Error(`${precision}/${format}: cached pixels differ: ${actual} / ${expected}`);
				// 【GPU完了を待たずに次の画像を送っても、各フレームの画素を独立して保持する】
				// プレビューの先行処理では同じ作業用画像を次のフレームが更新する。
				// submit順の依存関係でコピーが保護され、透明度・HDR値も混ざらないことを実GPUで確認する。
				const secondEncoder = device.createCommandEncoder();
				const second = cache.capture(secondEncoder, source, null);
				if (second == null) throw new Error('Second frame was not captured');
				device.queue.submit([secondEncoder.finish()]);
				device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: pixels.byteLength / 2 }, [2, 2]);
				const thirdEncoder = device.createCommandEncoder();
				const third = cache.capture(thirdEncoder, source, null);
				if (third == null) throw new Error('Third frame was not captured');
				device.queue.submit([thirdEncoder.finish()]);
				await device.queue.onSubmittedWorkDone();
				cache.commit(1, second);
				cache.commit(2, third);
				const blank = await read(cache.get(1)!.texture);
				const restored = await read(cache.get(2)!.texture);
				const hasAlpha = format.startsWith('rgba') || format.startsWith('bgra');
				if (blank.some((value, index) => Math.abs(value - (!hasAlpha && index % 4 === 3 ? 1 : 0)) > 1e-6)) throw new Error(`${format}: submitted frames mixed`);
				if (pixelsDiffer(restored)) throw new Error(`${precision}/${format}: following frame pixels differ`);
				const error = await device.popErrorScope();
				if (error != null) throw new Error(error.message);
				checks.push(`${precision}/${format}`);
			} finally { cache.dispose(); source.destroy(); }
		}
		return checks;
	} finally { device.destroy(); }
}
