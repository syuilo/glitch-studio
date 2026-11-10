import { LinearImageReadback } from '../../src/linear-image-readback.ts';
import { TimelineRendererManager } from '../../src/timeline-renderer-manager.ts';
import fillDefinition from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
import fillImplementation from '@gs/subsystems_effect_shared/fx/fill/_impl_.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const checks: string[] = [];
	const width = 3, height = 273;
	try {
		const source = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		const pixels = new Uint16Array(width * height * 4);
		for (let pixel = 0; pixel < width * height; pixel++) pixels.set([0x4000 + pixel, 0xb800, 0x3400, pixel % 2 === 0 ? 0 : 0x3800], pixel * 4);
		device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: width * 8 }, [width, height]);
		const image = new LinearImageReadback(device, width, height);
		try {
			const commands = device.createCommandEncoder();
			image.capture(source, commands);
			device.queue.submit([commands.finish()]);
			for (const rowsPerBlock of [1, 16]) {
				let offset = 0;
				for await (const block of image.readBlocks(rowsPerBlock, new AbortController().signal)) {
					for (let sample = 0; sample < block.length; sample++) if (block[sample] !== pixels[offset + sample]) throw new Error(`Wrong HALF value at ${offset + sample}`);
					offset += block.length;
				}
				if (offset !== pixels.length) throw new Error('Missing final rows');
				checks.push(`HALF readback with ${rowsPerBlock} rows per block`);
			}
			const controller = new AbortController();
			const blocks = image.readBlocks(16, controller.signal);
			await blocks.next();
			controller.abort();
			let aborted = false;
			try { await blocks.next(); } catch (error) { aborted = error instanceof DOMException && error.name === 'AbortError'; }
			if (!aborted) throw new Error('Readback ignored cancellation');
			checks.push('cancelled readback');
		} finally { image.dispose(); source.destroy(); }
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('webgpu')!;
		const manager = await TimelineRendererManager.create({ gpuDevice: device, gpuContext: context,
			effectDefinitions: { fill: fillDefinition }, effectImplementations: { fill: fillImplementation } }, {
			timelineFps: 60, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 },
			enable32bitDataTextures: false, enableStats: false, enableWaveformAndHistogram: false,
		}, { assets: [] });
		try {
			manager.updateDynamicOptions({ resolution: { width, height }, outputResolution: { width, height }, sceneId: 'scene',
				previewExposure: 10, previewBackground: 'checker', opaqueOutput: true, highlightClipping: true,
				previewGamutCompression: { mode: 'custom', customAmount: 1 },
				timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{
					id: 'fill', name: 'Fill', layerType: 'effect', effectId: 'fill', resolution: { mode: 'auto', scale: 1 },
					effectParamValues: { color: { inputSource: 'literal', value: [4, -1, 0.5, 0.5] } },
					compositingParamValues: {}, automationGraphs: [], clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }],
				}] }],
			});
			const rendered = await manager.renderTimelineLinearFrame(500, new AbortController().signal);
			try {
				for await (const block of rendered.readBlocks(16, new AbortController().signal)) {
					for (let sample = 0; sample < block.length; sample++) if (block[sample] !== [0x4000, 0xb800, 0x3400, 0x3800][sample % 4]) throw new Error('Display settings changed the linear scene');
				}
			} finally { rendered.dispose(); }
			checks.push('scene motion blur preserves linear HDR independently of preview settings');
		} finally { manager.destroy(); }
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { device.destroy(); }
}
