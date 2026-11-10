import { createWaveform } from '@gs/shared/utility/waveform/waveform.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import { GpuHistogram } from '../../src/utility/histogram/GpuHistogram.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const errors: string[] = [];
	device.addEventListener('uncapturederror', event => errors.push(event.error.message));
	const checks: string[] = [];
	async function read(output: GPUTexture, encoder: GPUCommandEncoder) {
		const bytesPerRow = Math.ceil(output.width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * output.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, [output.width, output.height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Uint8Array(output.width * output.height * 4);
			const padded = new Uint8Array(buffer.getMappedRange());
			for (let row = 0; row < output.height; row++) pixels.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + output.width * 4), row * output.width * 4);
			return pixels;
		} finally { buffer.destroy(); }
	}
	try {
		for (const direction of ['horizontal', 'vertical'] as const) {
			const size = direction === 'horizontal' ? { width: 1, height: 256 } : { width: 256, height: 1 };
			const output = device.createTexture({ size, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const source = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			const waveform = createWaveform({ device, vertexShaderModule: device.createShaderModule({ code: vertexCode }), format: 'rgba8unorm' });
			try {
				// 不透明・半透明の色、alpha=0の数値データの両入力構成を、同じ所有インスタンスで往復する。
				for (const [kind, mode, rgba] of [
					['uniform', 'rgb', [0, 0.5, 1, 1]],
					['texture', 'rgb', [0, 0.125, 0.25, 0.25]],
					['uniform', 'vectorX', [0.25, 0, 0, 0]],
				] as const) {
					device.queue.writeTexture({ texture: source }, new Uint16Array(rgba.map(float32ToFloat16Bits)), { bytesPerRow: 8 }, [1, 1]);
					const input: ShaderInput = kind === 'uniform' ? { kind: 'uniform', value: [...rgba] } : textureShaderInput(source, { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' });
					let reference: Uint8Array | null = null;
					for (const count of [4096, 65537, 65538, 262144, 4096]) {
						const sampleSize = direction === 'horizontal' ? { width: 1, height: count } : { width: count, height: 1 };
						const weight = mode === 'rgb' ? Math.round(rgba[3] * 65535) / 65535 : 1;
						const encoder = device.createCommandEncoder();
						if (!waveform.prepare(input, { mode, direction, valueScale: 'linear', intensity: 1 / (count * weight),
							size, sampleSize, fitSize: { width: 1, height: 1 } }, encoder)) throw new Error('Waveform preparation failed');
						const compute = encoder.beginComputePass(); waveform.accumulate(compute); compute.end();
						const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
						waveform.render(pass); pass.end();
						const pixels = await read(output, encoder);
						if (reference == null) {
							const peak = Math.max(...pixels.filter((_value, index) => index % 4 !== 3));
							const expectedPeak = Math.round((1 - Math.exp(-(mode === 'rgb' ? 1 : 0.75))) * 255);
							if (Math.abs(peak - expectedPeak) > 1) throw new Error(`Reference waveform normalization: ${peak}, expected ${expectedPeak}`);
							reference = pixels;
						} else if (pixels.some((value, index) => Math.abs(value - reference![index]) > 1)) throw new Error(`Waveform accumulation changed at ${count} samples (${direction}, ${kind}, ${mode})`);
					}
					checks.push(`${direction} ${kind} ${mode} matches across direct, u32 boundary, split, and return`);
				}
				// 3つの位置サンプルを2ビンへ入れると、最大65538・残り32769になる。
				// 切り上げによる上限判定と、各ビンの先頭位置からの部分和番号を同時に検証する。
				const irregularSize = direction === 'horizontal' ? { width: 2, height: 256 } : { width: 256, height: 2 };
				const irregularOutput = device.createTexture({ size: irregularSize, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
				try {
					const encoder = device.createCommandEncoder();
					waveform.prepare({ kind: 'uniform', value: [0, 0, 0, 1] }, { mode: 'vectorX', direction, intensity: 1 / 65538,
						valueScale: 'linear', size: irregularSize, fitSize: { width: 1, height: 1 },
						sampleSize: direction === 'horizontal' ? { width: 3, height: 32769 } : { width: 32769, height: 3 } }, encoder);
					const compute = encoder.beginComputePass(); waveform.accumulate(compute); compute.end();
					const pass = encoder.beginRenderPass({ colorAttachments: [{ view: irregularOutput.createView(), loadOp: 'clear', storeOp: 'store' }] });
					waveform.render(pass); pass.end();
					const pixels = await read(irregularOutput, encoder);
					for (const position of [0, 1]) {
						const index = direction === 'horizontal' ? (255 * 2 + position) * 4 : position * 256 * 4;
						const expected = Math.round((1 - Math.exp(-(position === 0 ? 1 : 0.5))) * 255);
						if (Math.abs(pixels[index] - expected) > 1) throw new Error('Uneven position bins lost partial counts');
					}
					checks.push(`${direction} uneven position bins retain all partial counts`);
				} finally { irregularOutput.destroy(); }
			} finally { waveform.dispose(); source.destroy(); output.destroy(); }
		}
		const output = device.createTexture({ size: [256, 150], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const histogram = new GpuHistogram(device, { canvas: new OffscreenCanvas(256, 150), configure() {}, unconfigure() {}, getCurrentTexture: () => output }, 'rgba8unorm');
		histogram.valueScale = 'linear';
		try {
			for (const target of ['rgb', 'vectorX'] as const) {
				for (const dense of [false, true]) {
					let reference: Uint8Array | null = null;
					for (const width of [256, 257, 256]) {
						const height = 256;
						const source = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
						try {
							const data = new Uint16Array(width * height * 4);
							for (let index = 0; index < width * height; index++) {
								const first = dense ? index < width * height - 128 : index % 4 === 0;
								const values = first ? [0.25, 0.5, 0.75, 1] : [0.75, 0.25, 0.5, 1];
								data.set(values.map(float32ToFloat16Bits), index * 4);
							}
							device.queue.writeTexture({ texture: source }, data, { bytesPerRow: width * 8 }, [width, height]);
							histogram.target = target;
							const encoder = device.createCommandEncoder();
							histogram.render(encoder, source, true);
							const pixels = await read(output, encoder);
							if (reference == null) {
								if (!pixels.some((value, index) => index % 4 !== 3 && value > 0)) throw new Error('Reference histogram is empty');
								reference = pixels;
							} else if (pixels.some((value, index) => value !== reference![index])) throw new Error(`Histogram changed across the overflow boundary (${target}, dense=${dense})`);
						} finally { source.destroy(); }
					}
					checks.push(`${target} histogram ${dense ? 'dense' : 'mixed'} matches across direct, split, and return`);
				}
			}
		} finally { histogram.dispose(); output.destroy(); }
		await device.queue.onSubmittedWorkDone();
		if (errors.length > 0) throw new Error(errors.join('\n'));
		return checks;
	} finally { device.destroy(); }
}
