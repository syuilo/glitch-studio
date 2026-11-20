import { check, near, withGpu } from './native-effect-gpu-fixture.mjs';

const source = { type: 'nativeEffect', id: 'colorClamp' };

function checkPixels(actual, expected) {
	check(actual.length === expected.length, 'pixel count');
	expected.forEach((value, index) => near(actual[index], value, 'component ' + index));
}

export async function colorClamp() {
	await withGpu(async ({ gpu, create, read, render, pipelines }) => {
		const resolution = { width: 4, height: 1 };
		const uniform = await create(source, ['output'], {}, {
			resolution: { width: 1, height: 1 }, params: { input: { inputSource: 'literal', value: [4, -3, 2, 0.5] } },
		});
		try {
			check(render(uniform) === 1, 'one pass for uniform inputs');
			checkPixels(await read(uniform.outputs.get('output').texture), [0.5, 0, 0.5, 0.5]);
		} finally { uniform.dispose(); }

		function textureInput(width, format, values) {
			const size = { width, height: 1 };
			const texture = gpu.device.createTexture({ size, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
			gpu.device.queue.writeTexture({ texture }, new Float16Array(values), {}, size);
			return { kind: 'texture', texture, resolution: size, version: 0, sampling: { fitMode: 'stretch', filterMode: 'nearest', wrapMode: 'clamp' } };
		}

		const image = textureInput(4, 'rgba16float', [1, -1, 0.75, 0.5, 0.25, -0.5, 2, 0.5, 3, -1, 0.75, 0, -0.5, 0.75, -1, 0.25]);
		const redMaximum = textureInput(2, 'r16float', [1.5, 0.25]);
		const greenMinimum = textureInput(4, 'r16float', [-1.25, -0.5, -2, -1]);
		let redMinimum = -1.5;
		const mixed = await create(source, ['output'], {
			input: image, rMax: redMaximum, rMin: { kind: 'uniform', get value() { return [redMinimum]; } },
			gMax: { kind: 'uniform', value: [0.875] }, gMin: greenMinimum,
			bMax: { kind: 'uniform', value: [1.25] }, bMin: { kind: 'uniform', value: [-1.75] },
		}, { resolution });
		try {
			const output = mixed.outputs.get('output').texture;
			check(pipelines() === 2, 'one pipeline per placement at initialization');
			check(render(mixed) === 1, 'one pass for mixed inputs');
			checkPixels(await read(output), [
				0.75, -0.125, 0.625, 0.5, 0.25, 0.25, 0.625, 0.5,
				3, -1, 0.75, 0, -0.125, 0.21875, -0.1875, 0.25,
			]);
			check(render(mixed) === 0, 'reuse the output when inputs are unchanged');

			// 右端の画素では下限1が上限0.25を越える。上限を優先し、alpha=0の画素はそのまま通す。
			redMinimum = 0;
			check(render(mixed) === 1 && pipelines() === 2, 'update the uniform on the existing pipeline');
			checkPixels(await read(output), [
				0.75, -0.125, 0.625, 0.5, 0.5, 0.25, 0.625, 0.5,
				3, -1, 0.75, 0, 0.0625, 0.21875, -0.1875, 0.25,
			]);
		} finally {
			mixed.dispose();
			image.texture.destroy();
			redMaximum.texture.destroy();
			greenMinimum.texture.destroy();
		}
	});
}
