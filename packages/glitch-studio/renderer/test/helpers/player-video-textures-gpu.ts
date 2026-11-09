import { PlayerVideoTextures } from '../../src/player-video-textures.ts';
import videoImplementation from '@gs/subsystems_effect_shared/fx/video/_impl_.ts';
import type { FitMode } from '@gs/shared/types.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const owner = new PlayerVideoTextures(device);
	const vertex = device.createShaderModule({ code: vertexCode });
	const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
	const resolution = { width: 2, height: 1 };
	const effects = Array.from({ length: 2 }, () => {
		const texture = videoImplementation.outputTextureFactories.output({ wgpu, resolution });
		const instance = videoImplementation.init({ wgpu, resolution, params: { fit: 'stretch' }, reportStatus() {}, fallbackTexture: texture,
			resources: { player: { getVideoTexture: () => owner.getTexture('player') } } });
		return { texture, instance };
	});
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: '@group(0) @binding(0) var image: texture_2d<f32>; @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }' }),
		targets: [{ format: 'rgba32float' }],
	} });
	const target = device.createTexture({ size: [2, 1], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	let copies = 0;
	const originalCopy = device.queue.copyExternalImageToTexture;
	device.queue.copyExternalImageToTexture = (...args) => { copies++; originalCopy.apply(device.queue, args); };
	const checks: string[] = [];
	const frame = (gray: number) => new VideoFrame(new Uint8Array([gray, gray, gray, 128, 0, 0, 0, 0]), {
		format: 'RGBA', codedWidth: 2, codedHeight: 1, timestamp: 0,
		colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
	});
	function render(index: number, fit: FitMode = 'stretch') {
		const { texture, instance } = effects[index];
		const encoder = device.createCommandEncoder();
		instance.render({ params: { fit }, commandEncoder: encoder, time: 0, timeDelta: 0,
			pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
			outputDataMap: { output: { texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
			createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
			createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
			createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
		});
		device.queue.submit([encoder.finish()]);
	}
	async function checkPixels(index: number, gray: number, alpha: number) {
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
		pass.setPipeline(reader);
		pass.setBindGroup(0, device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: effects[index].texture.createView() }] }));
		pass.draw(3); pass.end();
		encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: 256 }, [2, 1]);
		device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		const pixels = new Float32Array(buffer.getMappedRange()).slice(0, 8);
		buffer.unmap();
		if ([gray, gray, gray, alpha, 0, 0, 0, 0].some((value, channel) => Math.abs(pixels[channel] - value) > 0.001)) throw new Error(`Wrong shared video pixels: ${pixels}`);
	}
	try {
		// 【同じPlayerを使う実Videoノードは、原寸のコピーとlinear化を一度だけ行う】
		// 転送回数だけでなく、両方の出力が正しいlinear値・alphaを持つことを確認する。
		owner.updateFrame('player', frame(128));
		render(0); render(1);
		if (copies !== 1) throw new Error('Video nodes normalized the same player separately');
		await checkPixels(0, 0.1083535, 128 / 255);
		await checkPixels(1, 0.1083535, 128 / 255);
		checks.push('shared normalization', 'first node pixels', 'second node pixels');
		render(1, 'contain');
		if (copies !== 1) throw new Error('Fit changes normalized the source again');
		checks.push('fit reuses normalized source');
		effects[0].instance.dispose();
		render(1);
		await checkPixels(1, 0.1083535, 128 / 255);
		checks.push('node disposal preserves borrowed source');
		owner.updateFrame('player', frame(64));
		render(1);
		if (copies !== 2) throw new Error('Player update did not normalize exactly once');
		await checkPixels(1, 0.0257353, 128 / 255);
		checks.push('new player frame updates pixels');
		owner.updateFrame('player', null);
		render(1);
		await checkPixels(1, 0, 0);
		checks.push('removed player clears output');
		owner.updateFrame('player', frame(128));
		render(1);
		await checkPixels(1, 0.1083535, 128 / 255);
		checks.push('recovered player refreshes borrowed binding');
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally {
		device.queue.copyExternalImageToTexture = originalCopy;
		for (const { texture, instance } of effects) { instance.dispose(); texture.destroy(); }
		owner.dispose(); target.destroy(); buffer.destroy(); device.destroy();
	}
}
