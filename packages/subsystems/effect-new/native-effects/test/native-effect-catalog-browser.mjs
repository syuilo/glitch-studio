import { nativeEffectDefinitions } from '../src/definitions.ts';
import { withGpu, check, near } from './native-effect-gpu-fixture.mjs';

export async function renderCatalog() {
	await withGpu(async ({ gpu, create, render, pipelines }) => {
		const { device } = gpu;
		const resolution = { width: 4, height: 4 };
		const texture = device.createTexture({ size: resolution, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
		const source = { kind: 'texture', texture, resolution, version: 0 };
		try {
			for (const [id, definition] of Object.entries(nativeEffectDefinitions)) {
				const ports = Object.keys(definition.outputDefs);
				const connectedInputs = Object.fromEntries(Object.entries(definition.paramDefs)
					.flatMap(([key, parameter]) => {
						if (parameter.canNode) return [[key, source]];
						if (parameter.element?.canNode) return [[key, { kind: 'array', elements: [source, { kind: 'uniform', value: [1, 0, 0, 1] }] }]];
						return [];
					}));
				for (const [usedPorts, inputs] of [[ports, {}], ...ports.map(port => [[port], connectedInputs])]) {
					gpu.enable32bitDataTextures = inputs === connectedInputs;
					device.pushErrorScope('validation');
					try {
						const instance = await create({ type: 'nativeEffect', id }, usedPorts, inputs);
						try {
							const initialPipelines = pipelines();
							const passes = render(instance);
							check(id === 'testStructArray' || passes > 0, 'no render pass');
							await device.queue.onSubmittedWorkDone();
							check(pipelines() === initialPipelines, 'pipeline created during render');
						} finally { instance.dispose(); }
						const error = await device.popErrorScope();
						if (error != null) throw new Error(error.message);
					} catch (error) {
						throw new Error(id + ' [' + usedPorts.join(', ') + ']: ' + error.message);
					}
				}
			}
		} finally { texture.destroy(); }
	});
}

export async function scalarGradient() {
	await withGpu(async ({ gpu: { device }, create, render, read }) => {
		const resolution = { width: 4, height: 1 };
		const texture = device.createTexture({ size: resolution, format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array([0, 1, 2, 3]), {}, resolution);
		const input = { kind: 'texture', texture, resolution, sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' } };
		const instance = await create({ type: 'nativeEffect', id: 'scalarGradient' }, ['output'], { input },
			{ resolution, params: { normalize: { inputSource: 'literal', value: true }, strength: { inputSource: 'literal', value: 2 } } });
		try {
			render(instance);
			const pixels = await read(instance.outputs.get('output').texture);
			near(pixels[4], 2, 'normalized horizontal derivative times strength');
			near(pixels[5], 0, 'vertical derivative');
		} finally {
			instance.dispose();
			texture.destroy();
		}
	});
}
