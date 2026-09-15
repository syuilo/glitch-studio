// Run Vite with packages/renderer as root, then open /test/bloom-browser.html.
import bloom from '../src/effect-implementations/bloom/main.ts';
import vertex from '../src/vertex.wgsl?raw';

const results = document.querySelector('#results');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const rows = [];
let device;
try {
	const adapter = await navigator.gpu.requestAdapter();
	check(adapter, 'WebGPU adapter unavailable');
	device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const wgpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertex }) };
	async function measure(width, quality, radius, thin = false, height = width / 2) {
		const pixels = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const lit = thin ? x === width / 2 : Math.hypot((x + 0.5) / width - 0.5, (y + 0.5 - height / 2) / width) < 0.025;
				const offset = (y * width + x) * 4;
				pixels.fill(lit ? 204 : 0, offset, offset + 3);
				pixels[offset + 3] = 255;
			}
		}
		const input = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture: input }, pixels, { bytesPerRow: width * 4 }, [width, height]);
		const output = device.createTexture({ size: [width, height], format: navigator.gpu.getPreferredCanvasFormat(), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: pixels.length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const params = { input, quality, radius, strength: 1, threshold: 0.5, softKnee: 0.5 };
		const instance = bloom.init({ wgpu, resolution: { width, height }, params, fallbackTexture: input });
		const encoder = device.createCommandEncoder();
		instance.render({ params, commandEncoder: encoder, createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor ?? {
			colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
		}) });
		encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: width * 4 }, [width, height]);
		device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		const rendered = new Uint8Array(buffer.getMappedRange());
		let energy = 0;
		let moment = 0;
		let lineGain = 0;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				const gain = Math.max(0, rendered[offset] - pixels[offset]);
				if (thin && x === width / 2) lineGain += gain / height;
				if (pixels[offset] > 0) continue;
				const distanceSquared = ((x + 0.5) / width - 0.5) ** 2 + ((y + 0.5 - height / 2) / width) ** 2;
				energy += gain;
				moment += gain * distanceSquared;
			}
		}
		const measurement = { width, height, quality, radius, thin, haloRadius: Math.sqrt(moment / energy), energy: energy / (width * width), lineGain };
		rows.push(measurement);
		buffer.unmap();
		instance.dispose();
		input.destroy(); output.destroy(); buffer.destroy();
		return measurement;
	}
	for (const radius of [0.7, 1]) {
		const baseline = await measure(1024, 0.5, radius);
		for (const [width, quality, height] of [[2048, 0.25], [2048, 0.5], [2048, 1], [1920, 0.75], [3840, 1, 2160]]) {
			const current = await measure(width, quality, radius, false, height);
			check(Math.abs(current.haloRadius / baseline.haloRadius - 1) < 0.1, 'halo radius changes by more than 10%');
			check(Math.abs(current.energy / baseline.energy - 1) < 0.15, 'halo energy changes by more than 15%');
		}
	}
	const low = await measure(2048, 0.25, 0, true);
	const high = await measure(2048, 1, 0, true);
	check(high.lineGain > 40 && high.lineGain > low.lineGain + 20, 'full quality must preserve a one-pixel highlight');
	const validationError = await device.popErrorScope();
	check(!validationError, validationError?.message);
	results.textContent = 'PASS\n' + JSON.stringify(rows, null, 2);
} catch (error) {
	results.textContent = 'FAIL: ' + error.stack + '\n' + JSON.stringify(rows, null, 2);
} finally {
	device?.destroy();
}
