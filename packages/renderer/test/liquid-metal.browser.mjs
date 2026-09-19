// Run from a Vite-served page:
// await (await import('/test/liquid-metal.browser.mjs')).testLiquidMetal()
export async function testLiquidMetal() {
	const { default: effect } = await import('@glitch/shared/effects/liquidMetal/_impl_.ts');
	const { default: definition } = await import('@glitch/shared/effects/liquidMetal/_def_.ts');
	const { default: vertex } = await import('../src/vertex.wgsl?raw');
	const adapter = await navigator.gpu.requestAdapter();
	const device = await adapter.requestDevice();
	const errors = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	device.pushErrorScope('validation');
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const size = 64;
	const resolution = { width: size, height: size };
	const wgpu = { device, intermediateTextureFormat: 'rgba8unorm', enable32bitDataTextures: false, defaultVertexShaderModule: device.createShaderModule({ code: vertex }) };
	const source = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
	const empty = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
	const wide = device.createTexture({ size: [size * 2, size], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
	device.queue.writeTexture({ texture: wide }, new Uint8Array(size * size * 8).fill(255), { bytesPerRow: size * 8 }, [size * 2, size]);
	const pixels = new Uint8Array(size * size * 4);
	for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) pixels.set([255, 0, 0, 255], (y * size + x) * 4);
	device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, size]);
	const params = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => {
		const entry = def.default();
		return [key, entry.type === 'literal' ? entry.value : 0];
	}));
	Object.assign(params, { input: source, colorBack: [170 / 255, 170 / 255, 172 / 255, 0] });
	const target = device.createTexture({ size: [size, size], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const readback = device.createBuffer({ size: pixels.length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const instance = effect.init({ wgpu, resolution, params, fallbackTexture: empty });
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
		const first = await render();
		assert(first[(32 * size + 32) * 4 + 3] === 255, 'input shape must be opaque');
		assert(first.slice(0, 4).every(v => v === 0), 'outside shape must remain transparent black');
		params.time = 2;
		const animated = await render();
		assert(animated.some((v, i) => v !== first[i]), 'time must animate the metal');
		params.time = 0;
		const sought = await render();
		assert(sought.every((v, i) => v === first[i]), 'seeking must reproduce the frame');
		params.speed = 0;
		params.time = 100;
		assert((await render()).every((v, i) => v === first[i]), 'zero speed must freeze animation');
		params.frame = 2000;
		assert((await render()).every((v, i) => v === animated[i]), 'frame offset must use milliseconds');
		Object.assign(params, { time: 0, speed: 1, frame: 0 });
		for (let i = 0; i < pixels.length; i += 4) {
			if (pixels[i + 3]) pixels.set([0, 128, 0, 128], i);
		}
		device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: size * 4 }, [size, size]);
		const translucent = await render();
		const center = (32 * size + 32) * 4;
		assert(translucent[center + 3] === 128, 'original fractional alpha must survive preprocessing');
		for (let c = 0; c < 3; c++) assert(Math.abs(translucent[center + c] - first[center + c] * 128 / 255) <= 2, 'metal must use alpha, ignore source RGB, and premultiply once');
		Object.assign(params, { contour: 1, softness: 0, shiftRed: -1, shiftBlue: 1, distortion: 1, repetition: 10, angle: 2 });
		await render();
		Object.assign(params, { contour: 0, repetition: 1 });
		params.input = empty;
		assert((await render()).every(v => v === 0), 'changing input must rebuild the mask');
		params.input = source;
		device.queue.writeTexture({ texture: source }, new Uint8Array(pixels.length), { bytesPerRow: size * 4 }, [size, size]);
		assert((await render()).every(v => v === 0), 'updates to the same input texture must rebuild the mask');
		params.input = null;
		assert((await render()).every(v => v === 0), 'disconnected input must use the transparent fallback');
		params.input = wide;
		const resizedInput = await render();
		assert(resizedInput[center + 3] === 255, 'a replacement input with a different aspect ratio must render');
		const validation = await device.popErrorScope();
		assert(!validation && errors.length === 0, validation?.message ?? errors.join('\n'));
		return 'Liquid Metal GPU checks passed';
	} finally {
		instance.dispose();
		for (const resource of [source, empty, wide, target, readback]) resource.destroy();
		device.destroy();
	}
}


