import { textureShaderInput, type ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import definition from '../../src/fx/pixelStretch/_def_.ts';
import implementation from '../../src/fx/pixelStretch/_impl_.ts';
import { nativeEffectProbe } from './native-effect-probe.ts';

const probe = nativeEffectProbe(definition, implementation);

// 座標をそのまま色に符号化し、補間位置を読み戻す。HDR・負値・半透明も同時に通す。
function colorAt(x: number, y: number) {
	return [x / 8, -y / 8, 0.125, 0.5];
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const wgpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
	const resolution = { width: 16, height: 8 };
	const { width, height } = resolution;
	const bytesPerRow = 256;
	const inputTexture = device.createTexture({ size: resolution, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const pixels = Array.from({ length: width * height }, (_, index) => colorAt(index % width, Math.floor(index / width))).flat();
	device.queue.writeTexture({ texture: inputTexture }, new Float16Array(pixels), { bytesPerRow: width * 8 }, resolution);
	const input = textureShaderInput(inputTexture, { filterMode: 'linear', fitMode: 'stretch', wrapMode: 'repeat' });
	const output = probe.createTexture('output', { wgpu, resolution });
	const readback = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
	const instance = probe.place(wgpu, resolution);

	async function render(position: number, angle: number, source: ShaderInput | readonly number[] = input) {
		const commandEncoder = device.createCommandEncoder();
		await instance.draw({ params: { input: source, position, angle }, outputs: { output }, commandEncoder });
		commandEncoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow }, resolution);
		device.queue.submit([commandEncoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const values = new Float16Array(readback.getMappedRange().slice(0));
		readback.unmap();
		return (x: number, y: number, expected: readonly number[]) => {
			const offset = y * bytesPerRow / Float16Array.BYTES_PER_ELEMENT + x * 4;
			const actual = values.slice(offset, offset + 4);
			if (!actual.every((value, channel) => Math.abs(value - expected[channel]) < 0.002)) {
				throw new Error(`Position ${position}, Angle ${angle}, pixel (${x}, ${y}): ${actual} != ${expected}`);
			}
		};
	}

	try {
		// 【加工する側はAngleが示す進行方向の手前になる】
		// 右へ進む垂直境界の左側だけで、Yを保ったまま中央列の色を使う。
		const vertical = await render(0.5, 0.25);
		vertical(2, 6, colorAt(7.5, 6));
		vertical(12, 6, colorAt(12, 6));
		const bypass = await render(-0.5, 0.125);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) bypass(x, y, colorAt(x, y));
		}

		// 【45度の境界は横長の画像でも画素単位で45度になる】
		// 画像の添字では境界は x-y=4。左上の画素の垂足は画面外にあるので上端の交点を使う。
		const diagonal = await render(0.5, 0.125);
		diagonal(3, 4, colorAt(5.5, 1.5));
		diagonal(0, 0, colorAt(3.5, 0));
		diagonal(13, 6, colorAt(13, 6));

		// 【最前端では斜めの角と縦横の辺を区別する】
		// Repeatでも反対側の画素が混ざらず、辺では接線方向の色の違いが残る。
		const rightEdge = await render(1.5, 0.25);
		rightEdge(0, 0, colorAt(15, 0));
		rightEdge(8, 6, colorAt(15, 6));
		const topEdge = await render(1, 0);
		topEdge(0, 7, colorAt(0, 0));
		topEdge(8, 7, colorAt(8, 0));
		const corner = await render(1, 0.125);
		corner(0, 7, colorAt(15, 0));
		corner(15, 7, colorAt(15, 0));

		const uniform = await render(0.5, 0.125, [3, -1, 0.5, 0.5]);
		uniform(0, 0, [1.5, -0.5, 0.25, 0.5]);
		uniform(15, 0, [1.5, -0.5, 0.25, 0.5]);
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return true;
	} finally {
		instance.dispose();
		readback.destroy();
		output.destroy();
		inputTexture.destroy();
		device.destroy();
	}
}
