import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext, createPreviewCanvasConfigurator } from '../../src/preview-canvas-context.ts';
import { AssetTextures } from '../../src/asset-textures.ts';
import type { PreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import colorSpaceCode from '@gs/shared/gpu/color-space.wgsl?raw';
import valueScaleCode from '@gs/shared/gpu/image-value-scale.wgsl?raw';
import { IMAGE_VALUE_SCALES } from '@gs/shared/utility/image-value-scale.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const format = navigator.gpu.getPreferredCanvasFormat();
	const checks: string[] = [];
	let clock = 0;
	const previousClock = Object.getOwnPropertyDescriptor(performance, 'now');
	Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
	const pause = () => new Promise(resolve => setTimeout(resolve, 100));
	try {
		for (const mode of ['gpu', 'cpu'] as const) {
			clock = 0;
			let pixels: Uint8Array | null = null;
			let frameCount = 0;
			const output = device.createTexture({ size: [64, 64], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const context: PreviewCanvasContext = mode === 'cpu' ? new CpuPreviewCanvasContext(new OffscreenCanvas(64, 64), frame => {
				pixels = new Uint8Array(frame.pixels).slice();
				frameCount++;
				(context as CpuPreviewCanvasContext).recyclePixels(frame.frameId, frame.pixels);
			}) : { canvas: new OffscreenCanvas(64, 64), configure() {}, unconfigure() {}, getCurrentTexture: () => output };
			context.configure({ device, format, alphaMode: 'premultiplied' });
			let analysisFrames = 0;
			const analysisContexts = mode === 'cpu' ? [[256, 150], [512, 256], [256, 512]].map(([width, height], index) => new CpuPreviewCanvasContext(new OffscreenCanvas(width, height), frame => {
				analysisFrames++;
				analysisContexts[index].recyclePixels(frame.frameId, frame.pixels);
			})) : [];
			const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context, enableWaveformAndHistogram: mode === 'cpu',
				histogramGpuContext: analysisContexts[0], waveformHorizontalGpuContext: analysisContexts[1], waveformVerticalGpuContext: analysisContexts[2] });
			renderer.previewActive = true;
			const source = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			const read = async () => {
				if (mode === 'cpu') return pixels!;
				const buffer = device.createBuffer({ size: 64 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
				try {
					const encoder = device.createCommandEncoder();
					encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: 256 }, [64, 64]);
					device.queue.submit([encoder.finish()]);
					await buffer.mapAsync(GPUMapMode.READ);
					return new Uint8Array(buffer.getMappedRange()).slice();
				} finally { buffer.destroy(); }
			};
			try {
				device.queue.writeTexture({ texture: source }, new Uint16Array(4), { bytesPerRow: 8 }, [1, 1]);
				renderer.previewBackground = 'checker';
				const frame = renderer.tryReserveCpuPreviewFrame();
				const encoder = device.createCommandEncoder();
				renderer.renderToCanvas(source, encoder);
				frame?.prepareReadback(encoder);
				device.queue.submit([encoder.finish()]);
				await frame?.complete();
				const offset = (4 * 64 + 20) * 4;
				if ((await read())[offset] !== 26) throw new Error(`${mode}: wrong checker color`);
				checks.push(`${mode} linear checker color`);
				const initialAnalysisFrames = analysisFrames;
				// 【停止中の背景は借用画像を破棄した後も、自分のlinear画像だけで再描画する】
				// GPU参照の寿命違反や、停止中のアニメーション消失を実際のtimerとreadbackで検出する。
				source.destroy();
				clock = 175;
				await pause();
				if ((await read())[offset] !== 16) throw new Error(`${mode}: checker did not animate from the owned image`);
				checks.push(`${mode} idle checker preserves source lifetime`);
				// 【背景だけを更新する間は、実際の解析Canvasを読み戻し・転送しない】
				// 主Canvasだけの構成では、全出力用予約への逆戻りを検出できない。
				if (analysisFrames !== initialAnalysisFrames || (mode === 'cpu' && analysisFrames !== 3)) throw new Error('Idle checker transferred unchanged analysis canvases');
				checks.push(`${mode} idle checker skips analysis readback`);
				renderer.previewActive = false;
				const hiddenFrameCount = frameCount;
				clock = 350;
				await pause();
				if ((await read())[offset] !== 16 || frameCount !== hiddenFrameCount) throw new Error(`${mode}: hidden preview kept animating`);
				renderer.previewActive = true;
				await pause();
				if ((await read())[offset] !== 26) throw new Error(`${mode}: active preview did not resume its background`);
				checks.push(`${mode} preview activity stops and resumes background`);
				renderer.clear();
				const stoppedCount = frameCount;
				clock = 0;
				await pause();
				if ((await read())[offset] !== 26 || (mode === 'cpu' && frameCount !== stoppedCount)) throw new Error(`${mode}: checker continued after clear`);
				checks.push(`${mode} checker stops and releases pending frames`);
				// 【PNGの中間調は取り込みと表示を往復しても、元のsRGB値とalphaを保つ】
				// 個々の伝達関数だけでは検出できない、入出力境界での二重変換を確認する。
				const image = new OffscreenCanvas(1, 1);
				const imageContext = image.getContext('2d')!;
				renderer.previewBackground = null;
				for (const alpha of [255, 128]) {
					imageContext.putImageData(new ImageData(new Uint8ClampedArray([128, 128, 128, alpha]), 1, 1), 0, 0);
					const fileData = await image.convertToBlob({ type: 'image/png' });
					const assets = new AssetTextures(device, [{ id: 'gray', name: 'gray', width: 1, height: 1, fileData, fileDataType: fileData.type }]);
					try {
						await assets.ready;
						const frame = renderer.tryReserveCpuPreviewFrame();
						const encoder = device.createCommandEncoder();
						renderer.renderToCanvas(assets.textures.get('gray')!, encoder);
						frame?.prepareReadback(encoder);
						device.queue.submit([encoder.finish()]);
						await frame?.complete();
						const actual = await read();
						const gray = mode === 'cpu' ? 128 : 128 * alpha / 255;
						if ([gray, gray, gray, alpha].some((value, index) => Math.abs(actual[index] - value) > 1)) throw new Error(`${mode}: PNG gray round trip ${actual.slice(0, 4)}`);
						checks.push(`${mode} PNG gray round trip at alpha ${alpha}`);
					} finally { assets.dispose(); }
				}
			} finally { renderer.destroy(); context.unconfigure(); source.destroy(); output.destroy(); }
		}
		const target = device.createTexture({ size: [IMAGE_VALUE_SCALES.length, 2], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: device.createShaderModule({ code: vertexCode }) }, fragment: {
				module: device.createShaderModule({ code: colorSpaceCode + '\n' + valueScaleCode + '\n' + `
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
	let input = select(vec3f(0.0, 0.18, 1.0), vec3f(-1.0, -0.5, 0.0), p.y > 1.0);
	return vec4f(imageValueForScope(input, u32(p.x)), 1.0);
}` }),
				targets: [{ format: 'rgba32float' }],
			} });
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(pipeline); pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: 256 }, [IMAGE_VALUE_SCALES.length, 2]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const values = new Float32Array(buffer.getMappedRange());
			for (const [scale, expected] of [['srgb', 0.46135613], ['linear', 0.236], ['ev', 0.5], ['linearZeroToOne', 0.18], ['linearMinusOneToOne', 0.59]] as const) {
				const index = IMAGE_VALUE_SCALES.indexOf(scale);
				if (Math.abs(values[index * 4 + 1] - expected) > 0.00001) throw new Error(`scope scale ${index} has the wrong middle gray`);
				checks.push(`scope scale ${index} middle gray`);
			}
			// 【データ用Linear軸は正負の値をsRGB変換せず、固定範囲へ配置する】
			// 中間調だけでは、符号の消失や0基準のずれ、端点だけに合わせた誤変換を検出できない。
			// clamp前の実GPU出力を比較し、0〜1軸でも負値を途中で失わないことを確認する。
			for (const { scale, row, expected } of [
				{ scale: 'linearZeroToOne', row: 0, expected: [0, 0.18, 1] },
				{ scale: 'linearZeroToOne', row: 1, expected: [-1, -0.5, 0] },
				{ scale: 'linearMinusOneToOne', row: 0, expected: [0.5, 0.59, 1] },
				{ scale: 'linearMinusOneToOne', row: 1, expected: [0, 0.25, 0.5] },
			] as const) {
				const offset = row * 64 + IMAGE_VALUE_SCALES.indexOf(scale) * 4;
				const actual = values.slice(offset, offset + 3);
				if (expected.some((value, channel) => Math.abs(actual[channel] - value) > 0.00001)) throw new Error(`scope scale ${scale} row ${row}: ${actual}, expected ${expected}`);
				checks.push(`scope scale ${scale} fixed linear range row ${row}`);
			}
			buffer.unmap();
		} finally { buffer.destroy(); target.destroy(); }
		checks.push(...await checkCanvasAlphaPresentation(device));
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally {
		if (previousClock != null) Object.defineProperty(performance, 'now', previousClock); else delete (performance as Partial<Performance>).now;
		device.destroy();
	}
}

export async function runWideGamutAssetImport() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const checks: string[] = [];
	const image = new OffscreenCanvas(1, 1);
	const context = image.getContext('2d', { colorSpace: 'display-p3' })!;
	const target = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const readback = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const pipeline = device.createRenderPipeline({
		layout: 'auto', vertex: { module: device.createShaderModule({ code: vertexCode }) },
		fragment: { module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs() -> @location(0) vec4f { return textureLoad(image, vec2i(0), 0); }
` }), targets: [{ format: 'rgba16float' }] },
	});
	try {
		// 【不透明と半透明のDisplay P3素材で、原色変換・premultiplyの順序を保つ】
		// 原色の変換だけ、またはsRGBの半透明色だけでは、両方が重なると暗くなる問題を検出できない。
		// 実際のAssetTexturesを通し、広色域の負値・1超と、alphaに比例する光量をfloatで比較する。
		for (const alpha of [255, 128, 64]) {
			context.putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, alpha]), 1, 1, { colorSpace: 'display-p3' }), 0, 0);
			const fileData = await image.convertToBlob({ type: 'image/png' });
			const assets = new AssetTextures(device, [{ id: 'display-p3', name: 'display-p3', width: 1, height: 1, fileData, fileDataType: fileData.type }]);
			try {
				await assets.ready;
				const encoder = device.createCommandEncoder();
				const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: assets.textures.get('display-p3')!.createView() }] }));
				pass.draw(3);
				pass.end();
				encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
				device.queue.submit([encoder.finish()]);
				await readback.mapAsync(GPUMapMode.READ);
				const actual = new Float16Array(readback.getMappedRange()).slice(0, 4);
				readback.unmap();
				// D65のDisplay P3の赤をlinear sRGBへ変換した値。期待値は変換実装から生成しない。
				const expected = [1.22494, -0.042057, -0.019638, 1].map(value => value * alpha / 255);
				if (expected.some((value, channel) => Math.abs(actual[channel] - value) > 0.002)) throw new Error(`Display P3 asset at alpha ${alpha}: ${actual}, expected ${expected}`);
				checks.push(`Display P3 asset preserves premultiplied linear RGB at alpha ${alpha}`);
			} finally { assets.dispose(); }
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return checks;
	} finally { readback.destroy(); target.destroy(); device.destroy(); }
}

async function checkCanvasAlphaPresentation(device: GPUDevice): Promise<string[]> {
	const canvas = new OffscreenCanvas(1, 1);
	const context = canvas.getContext('webgpu')!;
	const configure = createPreviewCanvasConfigurator(device, context);
	const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context, enableWaveformAndHistogram: false });
	const source = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
	const snapshot = new OffscreenCanvas(1, 1).getContext('2d')!;
	const read = () => {
		snapshot.clearRect(0, 0, 1, 1);
		snapshot.drawImage(canvas, 0, 0);
		return snapshot.getImageData(0, 0, 1, 1).data;
	};
	const checks: string[] = [];
	try {
		// 【Canvasを画像として読む際も、不透明プレビューと透明書き出しを区別する】
		// GPUテクスチャの直接コピーではalphaModeの解釈を通らないため、drawImageで確認する。
		device.queue.writeTexture({ texture: source }, new Uint16Array([0x3000, 0x3000, 0x3000, 0x3800]), { bytesPerRow: 8 }, [1, 1]);
		for (const settings of [
			{ background: null, opaqueOutput: false, alphaMode: 'premultiplied', gray: 137, alpha: 128 },
			{ background: 'black', opaqueOutput: false, alphaMode: 'opaque', gray: 99, alpha: 255 },
			{ background: null, opaqueOutput: true, alphaMode: 'opaque', gray: 99, alpha: 255 },
			{ background: null, opaqueOutput: false, alphaMode: 'premultiplied', gray: 137, alpha: 128 },
		] as const) {
			renderer.previewBackground = settings.background;
			renderer.opaqueOutput = settings.opaqueOutput;
			configure(settings.alphaMode);
			if (context.getConfiguration()?.alphaMode !== settings.alphaMode) throw new Error('Canvas alphaMode does not match its output');
			const encoder = device.createCommandEncoder();
			renderer.renderToCanvas(source, encoder);
			device.queue.submit([encoder.finish()]);
			await device.queue.onSubmittedWorkDone();
			const actual = read();
			if ([settings.gray, settings.gray, settings.gray, settings.alpha].some((value, index) => Math.abs(value - actual[index]) > 1)) throw new Error(`Canvas ${settings.alphaMode} changed color or alpha: ${actual}`);
			checks.push(`${settings.alphaMode} Canvas image readback`);
			// 同じ設定の適用で再configureすると、直前の完成画像が失われる。
			configure(settings.alphaMode);
			const retained = read();
			if (retained.some((value, index) => value !== actual[index])) throw new Error('Repeated Canvas configuration cleared the image');
		}
		return checks;
	} finally { renderer.destroy(); context.unconfigure(); source.destroy(); }
}
