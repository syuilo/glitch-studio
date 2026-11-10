import { CanvasRenderer } from '../../src/canvas-renderer.ts';
import { CpuPreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import { createWaveform } from '@gs/shared/utility/waveform/waveform.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { PreviewCanvasContext } from '../../src/preview-canvas-context.ts';
import type { PreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('float32-filterable') ? ['float32-filterable'] : [] });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const format = navigator.gpu.getPreferredCanvasFormat();
	const checks: string[] = [];
	const settings: PreviewImageAnalysisSettings = { target: 'vectorX', valueScale: 'linear', valueRange: { minimum: 0, maximum: 1 }, waveformCanvasSizes: null, waveformViewports: null };
	function fixture(cpu: boolean) {
		const outputs: GPUTexture[] = [];
		const pixels: Uint8Array[] = [];
		const frames = [0, 0, 0, 0];
		const context = (width: number, height: number): PreviewCanvasContext => {
			const index = outputs.length;
			const output = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			outputs.push(output);
			if (!cpu) return { canvas: new OffscreenCanvas(width, height), configure() {}, unconfigure() {}, getCurrentTexture: () => output };
			const context = new CpuPreviewCanvasContext(new OffscreenCanvas(width, height), frame => {
				frames[index]++;
				pixels[index] = new Uint8Array(frame.pixels).slice();
				context.recyclePixels(frame.frameId, frame.pixels);
			});
			context.configure({ device, format, alphaMode: 'opaque' });
			return context;
		};
		const renderer = new CanvasRenderer({ gpuDevice: device, gpuContext: context(1, 1), enableWaveformAndHistogram: true,
			histogramGpuContext: context(256, 150), waveformHorizontalGpuContext: context(512, 256), waveformVerticalGpuContext: context(256, 512) });
		renderer.analysisTarget = 'vectorX';
		renderer.analysisValueScale = 'linear';
		return { renderer, frames, async read() {
			if (cpu) return pixels.slice(1);
			return Promise.all(outputs.slice(1).map(async output => {
				const buffer = device.createBuffer({ size: output.width * output.height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
				try {
					const encoder = device.createCommandEncoder();
					encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: output.width * 4 }, [output.width, output.height]);
					device.queue.submit([encoder.finish()]);
					await buffer.mapAsync(GPUMapMode.READ);
					return new Uint8Array(buffer.getMappedRange()).slice();
				} finally { buffer.destroy(); }
			}));
		}, async render(source: GPUTexture) {
			const frame = renderer.tryReserveCpuPreviewFrame();
			const encoder = device.createCommandEncoder();
			renderer.renderToCanvas(source, encoder);
			frame?.prepareReadback(encoder);
			device.queue.submit([encoder.finish()]);
			await (frame?.complete() ?? device.queue.onSubmittedWorkDone());
		}, dispose() { renderer.destroy(); for (const output of outputs) output.destroy(); } };
	}
	function equal(actual: Uint8Array[], expected: Uint8Array[]) { return actual.every((pixels, index) => pixels.every((value, offset) => value === expected[index][offset])); }
	try {
		for (const cpu of [false, true]) {
			const f = fixture(cpu);
			const width = cpu ? 1 : 2000;
			const height = cpu ? 1 : 1024;
			const source = device.createTexture({ size: [width, height], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			const data = new Uint16Array(width * height).fill(0x3400); // 0.25
			if (!cpu) for (let index = 0; index < data.length; index += 20) data[index] = 0x3a00; // 0.75
			device.queue.writeTexture({ texture: source }, data, { bytesPerRow: width * 2 }, [width, height]);
			try {
				await f.render(source);
				const standard = await f.read();
				const capture = f.renderer.setHighResolutionImageAnalysis(true, settings);
				if (cpu) f.renderer.clear(); // 取得中のScene変更でも保持画像は破棄しない。
				if (!await capture) throw new Error('High-res capture failed');
				const captured = await f.read();
				if (!cpu) {
					const offset = (149 * 256 + 191) * 4;
					if (standard[0][offset] !== 0 || captured[0][offset] !== 255) throw new Error('High-res skipped unsampled source pixels');
					if (captured[0][(130 * 256 + 191) * 4] !== 0) throw new Error('Histogram overflow changed the relative counts');
					checks.push('all source pixels and histogram counts beyond u32 fixed-point capacity');
				}
				const counts = [...f.frames];
				data.fill(0x3000); // 0.125。作業用テクスチャを再利用しても保持画像は変えない。
				device.queue.writeTexture({ texture: source }, data, { bytesPerRow: width * 2 }, [width, height]);
				await f.render(source);
				if (!equal(await f.read(), captured)) throw new Error('Live rendering changed the held analysis');
				if (cpu && (f.frames[0] !== counts[0] + 1 || f.frames.slice(1).some((count, index) => count !== counts[index + 1]))) throw new Error('Held CPU canvases were read back again');
				checks.push(`${cpu ? 'CPU' : 'GPU'} live preview preserves held analysis and skips repeated transfer`);
				// 元画像・エフェクトが破棄された後も、独立したfloatテクスチャを再解析する。
				source.destroy();
				f.renderer.clear();
				for (const target of ['vectorY', 'alpha', 'vectorLength', 'rgb'] as const) {
					const next = { ...settings, target, valueScale: target === 'rgb' ? 'srgb' as const : 'linear' as const };
					if (!await f.renderer.setHighResolutionImageAnalysis(true, next)) throw new Error('Reanalysis lost the held source');
					const actual = await f.read();
					if (target === 'vectorY' && actual[0][149 * 256 * 4] !== 255) throw new Error('Vector Y used the live frame');
					if (target === 'alpha' && actual[0][(149 * 256 + 255) * 4] !== 255) throw new Error('Alpha analysis lost the source format');
					checks.push(`${cpu ? 'CPU' : 'GPU'} reanalyzes held ${target} after source destruction`);
				}
				await f.renderer.setHighResolutionImageAnalysis(true, { ...settings, valueRange: { minimum: 1, maximum: -1 } });
				checks.push(`${cpu ? 'CPU' : 'GPU'} changes the held range without capturing the live frame`);
				await f.renderer.setHighResolutionImageAnalysis(false, settings);
				const fresh = device.createTexture({ size: [1, 1], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
				try {
					device.queue.writeTexture({ texture: fresh }, new Uint16Array([0x3000]), { bytesPerRow: 2 }, [1, 1]);
					await f.render(fresh);
					if (equal(await f.read(), captured)) throw new Error('Disabling High-res did not resume live analysis');
					checks.push(`${cpu ? 'CPU' : 'GPU'} resumes live analysis after disabling`);
				} finally { fresh.destroy(); }
			} finally { source.destroy(); f.dispose(); }
		}
		if (device.features.has('float32-filterable')) {
			const f = fixture(false);
			const source = device.createTexture({ size: [1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			try {
				device.queue.writeTexture({ texture: source }, new Float32Array([0.5001]), { bytesPerRow: 4 }, [1, 1]);
				await f.render(source);
				await f.renderer.setHighResolutionImageAnalysis(true, { ...settings, valueRange: { minimum: 0.5, maximum: 0.5002 } });
				if ((await f.read())[0][(75 * 256 + 128) * 4] !== 255) throw new Error('High-res reduced float32 precision');
				checks.push('preserves float32 snapshot precision');
			} finally { source.destroy(); f.dispose(); }
		}
		await checkWaveformOverflow(device);
		checks.push('waveform partial sums preserve a dense column beyond u32 fixed-point capacity');
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { device.destroy(); }
}

async function checkWaveformOverflow(device: GPUDevice) {
	const output = device.createTexture({ size: [1, 256], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const readback = device.createBuffer({ size: 256 * 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const waveform = createWaveform({ device, vertexShaderModule: device.createShaderModule({ code: vertexCode }), format: 'rgba8unorm' });
	try {
		const encoder = device.createCommandEncoder();
		waveform.prepare({ kind: 'uniform', value: [0.5, 0, 0, 1] }, { mode: 'vectorX', valueScale: 'linear', direction: 'horizontal', intensity: 0.000001,
			fitSize: { width: 512, height: 512 }, sampleSize: { width: 512, height: 512 }, size: { width: 1, height: 256 } }, encoder);
		const compute = encoder.beginComputePass(); waveform.accumulate(compute); compute.end();
		const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
		waveform.render(pass); pass.end();
		encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow: 256 }, [1, 256]);
		device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const actual = new Uint8Array(readback.getMappedRange())[127 * 256];
		if (Math.abs(actual - 31) > 1) throw new Error(`Waveform dense-column count overflow: ${actual}`);
	} finally { waveform.dispose(); readback.destroy(); output.destroy(); }
}
