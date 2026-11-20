import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init({ inputs, outputTextures }) {
		// 単色の書き込みはRender Passのclearで完了する。uniform bufferや専用pipelineは不要。
		const color: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: [{ view: outputTextures.get('output')!.createView(), clearValue: color, loadOp: 'clear', storeOp: 'store' }],
		};
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				const [r, g, b, a] = inputs.color.value;
				color.r = r * a;
				color.g = g * a;
				color.b = b * a;
				color.a = a;
				commandEncoder.beginRenderPass(descriptor).end();
			},
			dispose() {},
		};
	},
};

export default implementation;
