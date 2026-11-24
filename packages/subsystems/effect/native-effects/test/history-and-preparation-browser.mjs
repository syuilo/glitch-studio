import { BufferTarget, CanvasSource, Output, Quality, WebMOutputFormat } from 'mediabunny';
import { check, near, withGpu } from './native-effect-gpu-fixture.mjs';

export async function positionTrail() {
	await withGpu(async ({ create, render, read, textures }) => {
		const source = { type: 'nativeEffect', id: 'positionTrail' };
		let position = [0, 0];
		const inputs = { position: { kind: 'value', get value() { return position; } } };
		const both = await create(source, ['output', 'scalar'], inputs);
		const before = textures.length;
		const scalar = await create(source, ['scalar'], inputs);
		try {
			check(textures.length - before === 2, 'one scalar port owns two history textures');
			const samples = async instance => (await read(instance.outputs.get('scalar').texture)).filter((_, i) => i % 4 === 0);
			for (const x of [0, 0.12, -0.12]) {
				position = [x, 0];
				render(both, 30);
				render(scalar, 30);
				const full = await samples(both);
				const single = await samples(scalar);
				full.forEach((value, i) => near(single[i], value, 'scalar history at ' + i));
				if (x !== 0) check(single.some(value => value > 0), 'movement contributes to the trail');
			}
			scalar.resetRenderHistory();
			render(scalar, 30);
			check((await samples(scalar)).every(value => value === 0), 'reset clears texture and previous position');
		} finally {
			both.dispose();
			scalar.dispose();
		}
	});
}

export async function trailFrameRate(id, enable32bitDataTextures) {
	await withGpu(async ({ gpu, create, render, read }) => {
		gpu.enable32bitDataTextures = enable32bitDataTextures;
		const resolution = { width: 97, height: 49 };
		let position = [0, 0];
		let halfLife = 300;
		const instance = await create({ type: 'nativeEffect', id }, ['output', 'scalar'], {
			radius: { kind: 'value', value: 0.018 },
			halfLife: { kind: 'value', get value() { return halfLife; } },
			...(id === 'positionTrail' ? { position: { kind: 'value', get value() { return position; } } } : {}),
		}, { resolution });
		const draw = (time, timeDelta, sample) => {
			position = sample;
			render(instance, { time, timeDelta, pointerPosition: sample });
		};
		const readPort = port => read(instance.outputs.get(port).texture);
		const centerRowOffset = 4 * resolution.width * Math.floor(resolution.height / 2);
		// 16ビットの出力では履歴を毎フレーム書き戻すたびに丸めが発生する。
		const tolerance = enable32bitDataTextures ? 0.00005 : 0.0015;
		try {
			for (halfLife of [300, 1]) {
				let reference = null;
				for (const fps of [24, 60, 120]) {
					instance.resetRenderHistory();
					draw(0, 0, [-0.4, 0]);
					const frames = fps / 4;
					for (let step = 1; step <= frames; step++) {
						draw(step / fps, 1000 / fps, [-0.4 + 0.8 * step / frames, 0]);
					}
					const fields = await Promise.all([readPort('output'), readPort('scalar')]);
					const [vector, scalar] = fields;
					// 短い半減期でも終点付近には寄与が残る。長い半減期では低FPSでも全区間を辿れる。
					check(scalar[centerRowOffset + 86 * 4] > 0.01, `${fps} fps, half life ${halfLife}: trail near the end`);
					if (halfLife === 300) {
						for (let x = 14; x <= 82; x++) {
							const offset = centerRowOffset + 4 * x;
							check(scalar[offset] > 0.02, `${fps} fps: uninterrupted scalar trail at x=${x}`);
							near(vector[offset], scalar[offset], 'magnitude during straight movement');
							near(vector[offset + 1], 0, 'orthogonal component');
						}
						check(scalar[centerRowOffset + 4 * (3 * resolution.width + 48)] === 0, 'outside the brush radius');
					} else {
						near(scalar[centerRowOffset + 48 * 4], 0, 'older parts fade with a short half life', 0.000001);
					}
					if (reference == null) reference = fields;
					else fields.forEach((field, port) => field.forEach((value, index) => {
					near(value, reference[port][index], `${fps} fps, half life ${halfLife}, port ${port}, component ${index}`, tolerance);
					}));
				}
			}
		} finally {
			instance.dispose();
		}
	});
}

export async function pointerTrailMissingInput() {
	await withGpu(async ({ create, render, read }) => {
		const instance = await create({ type: 'nativeEffect', id: 'pointerTrail' }, ['scalar']);
		const draw = (time, timeDelta, pointerPosition) => render(instance, { time, timeDelta, pointerPosition });
		const samples = async () => (await read(instance.outputs.get('scalar').texture)).filter((_, index) => index % 4 === 0);
		try {
			draw(0, 0, [-0.4, 0]);
			draw(0.02, 20, [0.4, 0]);
			const trail = await samples();
			check(trail.some(value => value > 0), 'motion before missing input');
			draw(0.32, 300, [-99999, -99999]);
			draw(0.32, 0, [-0.4, 0]);
			(await samples()).forEach((value, index) => near(value, trail[index] / 2, 'history decays without connecting across missing input'));
		} finally {
			instance.dispose();
		}
	});
}

export async function recoverQrCode() {
	await withGpu(async ({ create, render, read }) => {
		let content = 'A';
		const instance = await create({ type: 'nativeEffect', id: 'qrCode' }, ['output'], {
			content: { kind: 'value', get value() { return content; } },
			version: { kind: 'value', value: 1 },
		}, { resolution: { width: 64, height: 64 } });
		try {
			const draw = async () => {
				const frame = { time: 0, timeDelta: 0 };
				await instance.prepare(frame);
				render(instance, frame);
				return read(instance.outputs.get('output').texture);
			};
			const original = await draw();
			content = 'A'.repeat(500);
			await instance.prepare({ time: 0, timeDelta: 0 }).then(() => { throw new Error('oversized version 1 QR code was accepted'); }, () => {});
			content = 'A';
			// キャッシュ済みの出力を再利用せず、符号化済みセルがそのまま使えることを確認する。
			instance.resetRenderHistory();
			const restored = await draw();
			check(original.some((value, index) => index % 4 === 0 && value > 0), 'QR code has light cells');
			original.forEach((value, i) => near(restored[i], value, 'restored QR code'));
		} finally { instance.dispose(); }
	});
}

export async function supersededAudio() {
	await withGpu(async ({ create, render, read }) => {
		const pending = Promise.withResolvers();
		const currentWindow = { sampleRate: 48000, frameCount: 64, sample: () => 0.25 };
		let reads = 0;
		const current = { cacheKey: 'current', sourceKey: 'audio', startFrame: 0, endFrame: 64, sampleRate: 48000,
			readWindow() { reads++; return currentWindow; } };
		let audio = { ...current, cacheKey: 'previous', readWindow: () => pending.promise };
		const instance = await create({ type: 'nativeEffect', id: 'audioWaveform' }, ['output'], {
			audio: { kind: 'value', get value() { return audio; } },
		}, { resolution: { width: 32, height: 32 } });
		try {
			const first = { time: 0, timeDelta: 0 };
			const next = { time: 0.05, timeDelta: 50 };
			check(!instance.tryPrepare(first), 'file audio waits for PCM');
			audio = current;
			check(instance.tryPrepare(next), 'live PCM is available synchronously');
			pending.resolve({ ...currentWindow, sample: () => -1 });
			await pending.promise;
			render(instance, next);
			const pixels = await read(instance.outputs.get('output').texture);
			check(pixels.some((value, index) => index % 4 === 3 && value > 0), 'waveform has coverage');
			const repeated = { ...next };
			await instance.prepare(repeated);
			render(instance, repeated);
			check(reads === 1, 'superseded window did not replace the current audio cache');
		} finally { instance.dispose(); }
	});
}

export async function seekVideo() {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const canvas = new OffscreenCanvas(16, 16);
	const context = canvas.getContext('2d');
	const video = new CanvasSource(canvas, { codec: 'vp8', quality: new Quality({ bitrate: 100000 }) });
	output.addVideoTrack(video, { frameRate: 2 });
	await output.start();
	for (const [index, color] of ['red', 'blue'].entries()) {
		context.fillStyle = color;
		context.fillRect(0, 0, 16, 16);
		await video.add(index / 2, 0.5);
	}
	video.close();
	await output.finalize();
	const file = new Blob([target.buffer], { type: 'video/webm' });

	await withGpu(async ({ create, render, read }) => {
		let position = 0;
		const instance = await create({ type: 'nativeEffect', id: 'videoFrame' }, ['output'], {
			time: { kind: 'value', get value() { return position; } },
			outOfRange: { kind: 'value', value: 'transparent' },
		}, { staticSettings: { asset: 'clip' }, resources: {
			assets: [{ id: 'clip', name: 'clip.webm', width: 16, height: 16, fileData: file, fileDataType: file.type }], assetTextures: new Map(),
		} });
		try {
			check(!instance.tryPrepare({ time: 0, timeDelta: 0 }), 'first decode is pending');
			for (const [time, expectedChannel] of [[1, 2], [1.1, null], [0, 0]]) {
				position = time;
				const frame = { time, timeDelta: 0 };
				await instance.prepare(frame);
				render(instance, frame);
				const pixel = await read(instance.outputs.get('output').texture);
				if (expectedChannel == null) near(pixel[3], 0, 'out-of-range seek clears the frame');
				else {
					check(pixel[expectedChannel] > 0.8, 'decoded frame at position ' + time);
					near(pixel[3], 1, 'opaque video frame');
				}
			}
		} finally { instance.dispose(); }
	});
}
