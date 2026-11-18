import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectRenderEnvironment, EffectRenderInstance } from '../../effect-render-instance.ts';

export function createSolidColorRenderInstance(environment: EffectRenderEnvironment, resolution: Resolution): EffectRenderInstance {
	const texture = environment.device.createTexture({
		label: 'Solid Color', size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
	});
	try {
		const view = texture.createView();
		const output: UniformOrTexture = { kind: 'texture', texture };
		return {
			async prepare() {},
			render({ commandEncoder, parameters, outputIds }) {
				if (!outputIds.has('color')) return new Map();
				const [r, g, b, a] = parameters.get('color') as readonly number[];
				commandEncoder.beginRenderPass({
					colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: r * a, g: g * a, b: b * a, a } }],
				}).end();
				return new Map([['color', output]]);
			},
			getOutputResolution: () => resolution,
			resetRenderHistory() {},
			destroy: () => texture.destroy(),
		};
	} catch (error) {
		texture.destroy();
		throw error;
	}
}
