import type definition from './_def_.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';

const createFillInstance: NativeEffectImplementation<typeof definition> = ({ device, resolution }) => {
	const texture = device.createTexture({
		label: 'Fill output',
		size: resolution,
		format: INTERMEDIATE_TEXTURE_FORMAT,
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const view = texture.createView();
	const outputs = new Map<string, UniformOrTexture>([['output', { kind: 'texture', texture }]]);
	return {
		getOutputKind: outputId => outputId === 'output' ? 'texture' : null,
		getOutputResolution: outputId => outputId === 'output' ? resolution : null,
		render: ({ commandEncoder, params, requestedOutputIds }) => {
			if (!requestedOutputIds.has('output')) return new Map();
			const [r, g, b, alpha] = params.color;
			// 単色なので描画パイプラインは不要。色を画像に書くこの境界で一度だけpremultiplyする。
			commandEncoder.beginRenderPass({ colorAttachments: [{
				view, loadOp: 'clear', storeOp: 'store', clearValue: [r * alpha, g * alpha, b * alpha, alpha],
			}] }).end();
			return outputs;
		},
		dispose: () => texture.destroy(),
	};
};

export default createFillInstance;
