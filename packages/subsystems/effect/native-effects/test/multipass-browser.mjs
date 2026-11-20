import { withGpu, check, near } from './native-effect-gpu-fixture.mjs';

export async function morphology() {
	await withGpu(async ({ gpu: { device }, create, render, read, pipelines }) => {
		const resolution = { width: 16, height: 1 };
		const samples = [0, 1, 3, 1, 4, 2, 6, 5, 2, 7, 3, 1, 5, 0, 2, 1];
		const texture = device.createTexture({ size: resolution, format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(samples), {}, resolution);
		let radius = 0;
		let operation = 'dilate';
		const instance = await create({ type: 'nativeEffect', id: 'dilateErode' }, ['output'], {
			input: { kind: 'texture', resolution, texture, sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' } },
			radius: { kind: 'value', get value() { return radius / resolution.width; } },
			operation: { kind: 'value', get value() { return operation; } },
		}, { resolution });
		try {
			const initialPipelines = pipelines();
			for (const [nextRadius, nextOperation] of [[0, 'dilate'], [7, 'dilate'], [2, 'erode'], [15, 'erode'], [1, 'dilate']]) {
				radius = nextRadius;
				operation = nextOperation;
				render(instance);
				const pixels = await read(instance.outputs.get('output').texture);
				for (let x = 0; x < samples.length; x++) {
					const window = samples.slice(Math.max(0, x - radius), x + radius + 1);
					const expected = operation === 'dilate' ? Math.max(...window) : Math.min(...window);
					near(pixels[x * 4], expected, operation + ' radius ' + radius + ' at ' + x);
				}
			}
			check(initialPipelines === pipelines(), 'radius and operation changes reuse the pipelines');
		} finally { instance.dispose(); texture.destroy(); }
	});
}

export async function shatterCoverage() {
	await withGpu(async ({ create, render, read, pipelines }) => {
		const resolution = { width: 13, height: 9 };
		let progress = 0;
		const inputs = { progress: { kind: 'uniform', get value() { return [progress]; } } };
		const source = { type: 'nativeEffect', id: 'shatterTransition' };
		const unused = { kind: 'texture', resolution, get texture() { throw new Error('coverage read an image input'); } };
		const coverage = await create(source, ['coverage'], { ...inputs, inputA: unused, inputB: unused }, { resolution });
		const both = await create(source, ['output', 'coverage'], inputs, { resolution });
		try {
			const initialPipelines = pipelines();
			for (progress of [0, 0.42, 1, 0.25]) {
				render(coverage);
				render(both);
				const mask = await read(coverage.outputs.get('coverage').texture);
				const reference = await read(both.outputs.get('coverage').texture);
				for (let i = 0; i < mask.length; i += 4) {
					near(mask[i], reference[i], 'coverage at ' + i);
					if (progress === 0 || progress === 1) near(mask[i], 1 - progress, 'endpoint');
				}
			}
			check(coverage.outputs.size === 1, 'coverage is the only published texture');
			check(initialPipelines === pipelines(), 'endpoints and geometry reuse the pipelines');
		} finally { coverage.dispose(); both.dispose(); }
	});
}


export async function discardedHistogram() {
	await withGpu(async ({ gpu: { device }, create, render, read }) => {
		const resolution = { width: 17, height: 17 };
		const source = { type: 'nativeEffect', id: 'cliffordDeJongAttractor' };
		const options = { resolution, params: { densityResolution: { inputSource: 'literal', value: '256' } } };
		const density = await create(source, ['density'], {}, options);
		const reference = await create(source, ['output', 'density'], {}, options);
		try {
			// 後続ノードの失敗などで、一度記録したヒストグラム生成が送信されなかった場合を再現する。
			const discarded = device.createCommandEncoder();
			density.render({ commandEncoder: discarded, time: 0, timeDelta: 0 });
			discarded.finish();
			density.resetRenderHistory();
			render(density);
			render(reference);
			const pixels = await read(density.outputs.get('density').texture);
			const expected = await read(reference.outputs.get('density').texture);
			let peak = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				near(pixels[i], expected[i], 'regenerated density at ' + i);
				peak = Math.max(peak, pixels[i]);
			}
			check(peak > 0, 'regenerated histogram contains samples');
			check(!density.dependsOnRenderHistory, 'a cached histogram is independent of playback history');
		} finally { density.dispose(); reference.dispose(); }
	});
}
