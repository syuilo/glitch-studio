import { VideoSample } from 'mediabunny';
import { createVideoTexture } from '../../src/media/video-texture.ts';
import type { IntermediateTextureFormat } from '../../src/types.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const completed: string[] = [];
	const readPipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: {
			module: device.createShaderModule({
				code: `
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	let positions = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	return vec4f(positions[index], 0.0, 1.0);
}`,
			}),
		},
		fragment: {
			targets: [{ format: 'rgba32float' }],
			module: device.createShaderModule({
				code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	return textureLoad(image, vec2i(position.xy), 0);
}`,
			}),
		},
	});

	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(readPipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout: readPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const data = new Float32Array(buffer.getMappedRange());
			return Array.from({ length: height }, (_, row) => [...data.slice(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4)]).flat();
		} finally { buffer.destroy(); target.destroy(); }
	}

	const rgbaColorSpace: VideoColorSpaceInit = {
		primaries: 'bt709',
		transfer: 'iec61966-2-1',
		matrix: 'rgb',
		fullRange: true,
	};
	const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [255, 0, 255, 255], [0, 255, 255, 255]];
	const rawSample = (pixels: number[][], width: number, height: number, rotation: 0 | 90 | 180 | 270 = 0, format: 'RGBA' | 'RGBX' = 'RGBA') => new VideoSample(new Uint8Array(pixels.flat()), {
		format,
		codedWidth: width,
		codedHeight: height,
		timestamp: 0,
		rotation,
		colorSpace: rgbaColorSpace,
	});
	const assertPixels = (name: string, actual: number[], expected: number[], tolerance = 0.012) => {
		if (actual.length !== expected.length || actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > tolerance)) {
			throw new Error(`${name}: ${actual} != ${expected}`);
		}
		completed.push(name);
	};
	try {
		for (const format of ['rgba8unorm', 'bgra8unorm', 'rgba16float'] satisfies IntermediateTextureFormat[]) {
			const uploader = createVideoTexture(device, format);
			try {
				// 【画素コピー由来のフレームも、回転後の寸法・向き・色を維持する】
				// 逆再生キャッシュはデコーダー由来ではない。非正方形の非対称パターンで
				// 上下反転・回転方向・縦横の取り違えをすべての中間形式で検出する。
				for (const pixelFormat of ['RGBA', 'RGBX'] as const) for (const [rotation, indices] of [[0, [0, 1, 2, 3, 4, 5]], [90, [3, 0, 4, 1, 5, 2]], [180, [5, 4, 3, 2, 1, 0]], [270, [2, 5, 1, 4, 0, 3]]] as const) {
					const sample = rawSample(colors, 3, 2, rotation, pixelFormat);
					let texture: GPUTexture;
					try { texture = uploader.upload(sample); } finally { sample.close(); }
					const expectedWidth = rotation % 180 === 0 ? 3 : 2;
					if (texture.width !== expectedWidth || texture.height !== 6 / expectedWidth) throw new Error('Wrong rotated video size');
					assertPixels(`${format} ${pixelFormat} rotation ${rotation}`, await read(texture), indices.flatMap(index => colors[index].map(value => value / 255)));
				}
				// 【透明画素の色は縮小後の輪郭へ混ぜず、alphaは一度だけ乗算する】
				// 線形補間後に乗算すると透明な緑が残り、二重乗算すると半透明の赤が暗くなる。
				for (const [name, pixels, expected] of [
					['transparent edge', [[255, 0, 0, 255], [0, 255, 0, 0]], [0.5, 0, 0, 0.5]],
					['translucent edge', [[255, 0, 0, 128], [0, 0, 255, 64]], [64 / 255, 0, 32 / 255, 96 / 255]],
				] as const) {
					const sample = rawSample(pixels.map(color => [...color]), 2, 1);
					let texture: GPUTexture;
					try { texture = uploader.upload(sample, 0.5); } finally { sample.close(); }
					assertPixels(`${format} ${name}`, await read(texture), [...expected]);
				}
				// 【VideoFrameの切り抜き・表示比率と、Mediabunnyの回転をそれぞれ一度だけ適用する】
				// coded領域には余白を置き、visibleRectと非正方形ピクセルの補正が失われる回帰を検出する。
				const padded = new Uint8Array(4 * 4 * 4);
				for (const [index, color] of [colors[0], colors[1], colors[2], colors[3]].entries()) padded.set(color, ((1 + Math.floor(index / 2)) * 4 + 1 + index % 2) * 4);
				const frame = new VideoFrame(padded, {
					format: 'RGBA',
					codedWidth: 4,
					codedHeight: 4,
					visibleRect: {
						x: 1,
						y: 1,
						width: 2,
						height: 2,
					},
					displayWidth: 4,
					displayHeight: 2,
					timestamp: 0,
					colorSpace: rgbaColorSpace,
				});
				const cropped = new VideoSample(frame, { rotation: 90 });
				const canvas = new OffscreenCanvas(2, 4);
				const context = canvas.getContext('2d')!;
				cropped.draw(context, 0, 0, 2, 4);
				const expectedCrop = [...context.getImageData(0, 0, 2, 4).data].map(value => value / 255);
				let croppedTexture: GPUTexture;
				try { croppedTexture = uploader.upload(cropped); } finally { cropped.close(); }
				if (croppedTexture.width !== 2 || croppedTexture.height !== 4) throw new Error('Wrong cropped video display size');
				assertPixels(`${format} crop and pixel aspect ratio`, await read(croppedTexture), expectedCrop);
			} finally { uploader.dispose(); }
		}
		// 【実デコーダーが返すYUVフレームを、元フレームの解放後も通常テクスチャとして読める】
		// RGBAの合成サンプルだけではハードウェア由来フレームの色変換や寿命を検証できない。
		const chunks: EncodedVideoChunk[] = [];
		let decoderConfig: VideoDecoderConfig | null = null;
		let codecError: Error | null = null;
		const encoder = new VideoEncoder({ output(chunk, metadata) { chunks.push(chunk); decoderConfig = metadata.decoderConfig ?? decoderConfig; }, error(error) { codecError = error; } });
		const decoded: VideoSample[] = [];
		const decoder = new VideoDecoder({ output(frame) { decoded.push(new VideoSample(frame)); }, error(error) { codecError = error; } });
		const uploader = createVideoTexture(device, 'rgba8unorm');
		try {
			encoder.configure({
				codec: 'avc1.42001f',
				width: 64,
				height: 32,
				bitrate: 1_000_000,
				framerate: 30,
			});
			for (let index = 0; index < 3; index++) {
				const sample = rawSample(Array.from({ length: 64 * 32 }, () => colors[index]), 64, 32);
				const frame = sample.toVideoFrame();
				try { encoder.encode(frame, { keyFrame: index === 0 }); } finally { frame.close(); sample.close(); }
			}
			await encoder.flush();
			if (codecError != null) throw codecError;
			if (decoderConfig == null) throw new Error('Missing video decoder configuration');
			decoder.configure(decoderConfig);
			for (const chunk of chunks) decoder.decode(chunk);
			await decoder.flush();
			if (codecError != null) throw codecError;
			if (decoded.length !== 3) throw new Error('Missing decoded video frames');
			for (const [index, sample] of decoded.entries()) {
				const texture = uploader.upload(sample, 0.5);
				sample.close();
				assertPixels(`decoded video frame ${index}`, (await read(texture)).slice(0, 4), colors[index].map(value => value / 255), 0.04);
			}
		} finally {
			for (const sample of decoded) sample.close();
			encoder.close(); decoder.close(); uploader.dispose();
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return completed;
	} finally { device.destroy(); }
}
