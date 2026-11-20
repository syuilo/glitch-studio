import { check, near, withGpu } from './native-effect-gpu-fixture.mjs';

const resolution = { width: 4, height: 1 };

function stripeInput(device) {
	const texture = device.createTexture({ size: resolution, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	device.queue.writeTexture({ texture }, new Float16Array([1, -1, 0, 1, 2, -2, 0, 1, 3, -3, 0, 1, 4, -4, 0, 1]), {}, resolution);
	return { kind: 'texture', texture, resolution, version: 0, sampling: { fitMode: 'cover', filterMode: 'nearest', wrapMode: 'clamp' } };
}

export async function interpolators() {
	await withGpu(async ({ gpu, create, render, read, pipelines }) => {
		const stripe = stripeInput(gpu.device);
		const constant = { kind: 'uniform', value: [-2, 2, 1, 0.5] };
		const last = { kind: 'uniform', value: [4, -4, 3, 0.25] };
		const elements = [constant, stripe, last];
		for (const [id, channels] of [['scalarInterpolator', 1], ['vectorInterpolator', 2], ['colorInterpolator', 4]]) {
			let index = 0;
			const instance = await create({ type: 'nativeEffect', id }, ['output'], {
				inputs: { kind: 'array', elements }, index: { kind: 'value', get value() { return index; } },
			}, { resolution });
			try {
				const compiled = pipelines();
				const second = [2, -2, 0, 1];
				const fromConstant = second.map((value, c) => 0.5 * constant.value[c] + 0.5 * value);
				const towardLast = weight => second.map((value, c) => (1 - weight) * value + weight * last.value[c]);
				for (const [value, expected] of [[0, constant.value], [0.5, fromConstant], [1, second], [1.25, towardLast(0.25)],
					[1.75, towardLast(0.75)], [2, last.value], [Infinity, last.value], [-Infinity, constant.value], [NaN, constant.value]]) {
					index = value;
					render(instance);
					const pixels = await read(instance.outputs.get('output').texture);
					for (let c = 0; c < channels; c++) {
						near(pixels[4 + c], expected[c], id + ' index ' + index);
					}
				}
				check(compiled === pipelines(), 'Interpolator index changes reuse the pipeline');
			} finally { instance.dispose(); }

			const empty = await create({ type: 'nativeEffect', id }, ['output'], { inputs: { kind: 'array', elements: [] } }, { resolution });
			try {
				render(empty);
				const pixels = await read(empty.outputs.get('output').texture);
				for (let c = 0; c < channels; c++) near(pixels[c], 0, id + ' empty input');
			} finally { empty.dispose(); }
		}
		stripe.texture.destroy();
	});
}

export async function interpolatorTextureBindings() {
	await withGpu(async ({ gpu, create, render, read, pipelines }) => {
		const { device } = gpu;
		const elements = Array.from({ length: device.limits.maxSampledTexturesPerShaderStage }, () => stripeInput(device));
		const narrowResolution = { width: 3, height: 1 };
		const narrow = device.createTexture({ size: narrowResolution, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture: narrow }, new Float16Array([8, 0, 0, 1, 12, 0, 0, 1, 16, 0, 0, 1]), {}, narrowResolution);
		elements.push({ kind: 'texture', texture: narrow, resolution: narrowResolution, version: 0,
			sampling: { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'linear' } });

		const last = elements.length - 1;
		let index = 0;
		const instance = await create({ type: 'nativeEffect', id: 'colorInterpolator' }, ['output'], {
			inputs: { kind: 'array', elements }, index: { kind: 'value', get value() { return index; } },
		}, { resolution });
		const createBindGroup = device.createBindGroup;
		const textureBindingCounts = [];
		device.createBindGroup = descriptor => {
			textureBindingCounts.push(descriptor.entries.filter(entry => entry.resource instanceof GPUTextureView).length);
			return createBindGroup.call(device, descriptor);
		};
		try {
			const compiled = pipelines();
			// 最後のケースは補間率をf32に丸めると1になるため、後ろの候補だけを使う。
			for (const [value, textureCount, expected] of [[0, 1, [1, 2, 3, 4]], [last - 0.5, 2, [2.5, 6, 8.5, 6]],
				[last - 2 ** -26, 1, [4, 10, 14, 8]]]) {
				index = value;
				textureBindingCounts.length = 0;
				render(instance);
				check(textureBindingCounts.length === 1 && textureBindingCounts[0] === textureCount,
					'index ' + index + ' created bind groups with texture counts ' + textureBindingCounts.join(', '));
				const pixels = await read(instance.outputs.get('output').texture);
				for (const [pixel, red] of expected.entries()) near(pixels[pixel * 4], red, 'index ' + index + ' pixel ' + pixel);
			}
			check(compiled === pipelines(), 'Interpolator texture switches reuse pipelines');
		} finally {
			device.createBindGroup = createBindGroup;
			instance.dispose();
			for (const element of elements) element.texture.destroy();
		}
	});
}

async function checkRedRow(instance, fixture, expected, label) {
	fixture.render(instance);
	const pixels = await fixture.read(instance.outputs.get('output').texture);
	for (const [index, value] of expected.entries()) near(pixels[index * 4], value, label + ' pixel ' + index);
}

export async function regionFit() {
	await withGpu(async fixture => {
		const input = stripeInput(fixture.gpu.device);
		let progress = 0;
		const instance = await fixture.create({ type: 'nativeEffect', id: 'splitTransition' }, ['output'], {
			inputA: input, inputB: input, progress: { kind: 'value', get value() { return progress; } },
		}, { resolution });
		try {
			const compiled = fixture.pipelines();
			await checkRedRow(instance, fixture, [1, 2, 3, 4], 'full width A');
			progress = 0.5;
			await checkRedRow(instance, fixture, [2, 3, 2, 3], 'cover in each half');
			progress = 1;
			await checkRedRow(instance, fixture, [1, 2, 3, 4], 'full width B');
			check(compiled === fixture.pipelines(), 'region changes reuse the pipeline');
		} finally { instance.dispose(); input.texture.destroy(); }
	});
}

export async function imageWrap() {
	await withGpu(async fixture => {
		const input = stripeInput(fixture.gpu.device);
		let wrap = 'repeat';
		const instance = await fixture.create({ type: 'nativeEffect', id: 'cellTransform' }, ['output'], {
			input, perCellTranslation: { kind: 'uniform', value: [1, 0] },
			translationUnit: { kind: 'value', value: 'canvas' }, wrapReference: { kind: 'value', value: 'image' },
			cellWrapMode: { kind: 'value', get value() { return wrap; } },
		}, { resolution });
		try {
			const compiled = fixture.pipelines();
			for (const [mode, row] of [['repeat', [1, 2, 3, 4]], ['repeatMirrored', [4, 3, 2, 1]], ['transparent', [0, 0, 0, 0]],
				['clamp', [1, 1, 1, 1]], ['repeat', [1, 2, 3, 4]]]) {
				wrap = mode;
				await checkRedRow(instance, fixture, row, mode);
			}
			check(compiled === fixture.pipelines(), 'wrap changes reuse the pipeline');
		} finally { instance.dispose(); input.texture.destroy(); }
	});
}
