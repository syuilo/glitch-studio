import { nativeEffectDefinitions } from '../src/definitions.ts';
import { check, near, withGpu } from './native-effect-gpu-fixture.mjs';

export async function renderStillImage() {
	await withGpu(async ({ gpu: { device }, create, render, read }) => {
		const graph = {
			kind: 'generate', primaryInputParameter: null, primaryOutput: 'output', resolutionInputParameters: [],
			paramDefs: nativeEffectDefinitions.image.paramDefs,
			outputDefs: nativeEffectDefinitions.invert.outputDefs,
			nodes: [
				{ id: 'image', effectSource: { type: 'nativeEffect', id: 'image' }, staticSettings: { image: 'photo' },
					resolution: { mode: 'context', scale: 1 },
					params: { fit: { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'fit' } } },
				{ id: 'invert', effectSource: { type: 'nativeEffect', id: 'invert' }, params: {
					input: { inputSource: 'node', source: { nodeId: 'image', outputPort: 'output' },
						sampling: { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' } },
				} },
			],
			outputSources: { output: { nodeId: 'invert', outputPort: 'output' } },
		};
		const size = { width: 2, height: 1 };
		const texture = device.createTexture({ size, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]), {}, size);
		const asset = { id: 'photo', ...size, fileData: new Blob(), fileDataType: 'image/png' };
		const fit = { kind: 'value', value: 'cover' };
		const instance = await create({ type: 'inlineNodesEffect', nodesEffect: graph }, ['output'], { fit }, {
			resolution: { width: 4, height: 4 }, resources: { assets: [asset], assetTextures: new Map([[asset.id, texture]]) },
		});
		try {
			// 横長の画像を正方形に描くと、左上の画素は cover では不透明、contain では透明になる。
			const frames = [['cover', 2, 1], ['cover', 0, 1], ['contain', 2, 0], ['contain', 0, 0]];
			for (const [index, [mode, expectedPasses, expectedCornerAlpha]] of frames.entries()) {
				fit.value = mode;
				const passes = render(instance, { time: index / 60, timeDelta: 1000 / 60 });
				check(passes === expectedPasses, `frame ${index}: expected ${expectedPasses} render passes, got ${passes}`);
				const pixels = await read(instance.outputs.get('output').texture);
				near(pixels[3], expectedCornerAlpha, `frame ${index} corner alpha`);
			}
		} finally {
			instance.dispose();
			texture.destroy();
		}
	});
}
