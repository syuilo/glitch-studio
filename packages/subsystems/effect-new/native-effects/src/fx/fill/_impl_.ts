import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { implementNativeEffect } from '@gs/subsystems_effect-new_renderer/native-effect/implement-native-effect.ts';
import type definition from './_def_.ts';

export default implementNativeEffect<typeof definition>(({ gpu, inputs, resolution }) => {
	const texture = gpu.device.createTexture({ size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
	const value = { kind: 'texture', texture } as const;
	const clearValue = { r: 0, g: 0, b: 0, a: 0 };
	const pass: GPURenderPassDescriptor = { colorAttachments: [{ view: texture.createView(), clearValue, loadOp: 'clear', storeOp: 'store' }] };
	return {
		outputs: { output: { kind: 'texture', resolution, read: () => value } },
		render(frame) {
			// 単色のためclearで全面を埋める。未乗算の入力はこの境界で一度だけ乗算する。
			const [r, g, b, a] = inputs.color.read(frame);
			clearValue.r = r * a;
			clearValue.g = g * a;
			clearValue.b = b * a;
			clearValue.a = a;
			frame.commandEncoder.beginRenderPass(pass).end();
		},
		dispose: () => texture.destroy(),
	};
});
