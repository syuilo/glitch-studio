// Run from a Vite-served page:
// await (await import('/test/water.browser.mjs')).testWater()
export async function testWater() {
	const { default: effect } = await import('@glitch/shared/effects/water/_impl_.ts');
	const { default: definition } = await import('@glitch/shared/effects/water/_def_.ts');
	const { default: vertex } = await import('../src/vertex.wgsl?raw');
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const device = await (await navigator.gpu.requestAdapter()).requestDevice();
	device.pushErrorScope('validation');
	const size = 64;
	const source = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
	const empty = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
	const pixels = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.set([x * 2, y * 2, 64, 128], (y * size + x) * 4);
	device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, size]);
	const params = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => {
		const entry = def.default();
		return [key, entry.type === 'literal' ? entry.value : 0];
	}));
	Object.assign(params, { input: source, highlights: 0, waves: 0, caustic: 0 });
	const target = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const readback = device.createBuffer({ size: pixels.length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const instance = effect.init({ wgpu: { device, intermediateTextureFormat: 'rgba8unorm', enable32bitDataTextures: false, defaultVertexShaderModule: device.createShaderModule({ code: vertex }) }, resolution: { width: size, height: size }, params, fallbackTexture: empty });
	async function render() {
		const encoder = device.createCommandEncoder();
		instance.render({ params, time: params.time, timeDelta: 0, commandEncoder: encoder, createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(), outputDataMap: { output: { texture: target, textureView: target.createView() } }, createPassEncoderFor: () => encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }) });
		encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: size * 4 }, [size, size]);
		device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const result = new Uint8Array(readback.getMappedRange()).slice();
		readback.unmap();
		return result;
	}
	try {
		const neutral = await render();
		const center = (32 * size + 32) * 4;
		assert(neutral[center + 3] === 128, 'fractional input alpha must be preserved');
		assert(neutral.slice(center, center + 3).every(v => Math.abs(v - 64) <= 1), 'premultiplied input RGB must not be multiplied by alpha twice');
		Object.assign(params, { waves: 0.3, caustic: 0.1, highlights: 0.07 });
		const first = await render();
		assert(first.some((v, i) => v !== neutral[i]), 'water must distort the input');
		for (const [key, value] of [['layering', 0], ['edges', 0], ['waves', 1], ['caustic', 1], ['size', 0.01], ['highlights', 1], ['colorHighlight', [1, 0, 0, 1]]]) {
			const previous = params[key];
			params[key] = value;
			assert((await render()).some((v, i) => v !== first[i]), `${key} must affect the rendered water`);
			params[key] = previous;
		}
		params.time = 2;
		const animated = await render();
		assert(animated.some((v, i) => v !== first[i]), 'time must animate the water');
		params.time = 0;
		assert((await render()).every((v, i) => v === first[i]), 'seeking must reproduce the frame');
		Object.assign(params, { time: 100, speed: 0 });
		assert((await render()).every((v, i) => v === first[i]), 'speed zero must freeze the water');
		params.frame = 2000;
		assert((await render()).every((v, i) => v === animated[i]), 'frame offset must use milliseconds');
		Object.assign(params, { input: null, highlights: 0 });
		assert((await render()).every(v => v === 0), 'disconnected input without highlights must be transparent');
		params.highlights = 1;
		assert((await render()).some(v => v > 0), 'highlights must work as a standalone water texture');
		params.colorHighlightAlpha = 0;
		assert((await render()).every(v => v === 0), 'highlight alpha zero must disable highlights');
		Object.assign(params, { input: source, waves: 0, caustic: 0, highlights: 0 });
		assert((await render()).every((v, i) => v === neutral[i]), 'reconnecting the input must restore its pixels');
		device.queue.writeTexture({ texture: source }, new Uint8Array(pixels.length), { bytesPerRow: size * 4 }, [size, size]);
		assert((await render()).every(v => v === 0), 'changes to the same input texture must render immediately');
		const validation = await device.popErrorScope();
		assert(!validation, validation?.message);
		return 'Water GPU checks passed';
	} finally {
		instance.dispose();
		for (const resource of [source, empty, target, readback]) resource.destroy();
		device.destroy();
	}
}
