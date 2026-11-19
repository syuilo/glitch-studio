import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { LinearSrgbColor } from '@gs/shared/color-space.ts';
import type { EffectInstance } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { CreateNativeEffectInstance } from '@gs/subsystems_effect-new_renderer/native-effect/native-effect-implementation.ts';

const createFillInstance: CreateNativeEffectInstance = ({ requestedOutputIds, resolution }, { device }): EffectInstance => {
	if (!requestedOutputIds.includes('output')) return { outputs: {}, render() {}, dispose() {} };

	// 全画素が同じ色なので、Render Passのクリア値で直接描ける。テクスチャは配置ごとの寸法を保つ。
	const texture = device.createTexture({
		size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
	});
	const view = texture.createView();
	const output = { kind: 'texture' as const, texture };
	return {
		outputs: { output: { layout: { kind: 'texture', resolution }, source: { type: 'produced', read: () => output } } },
		render({ parameters, commandEncoder }) {
			const [r, g, b, a] = parameters.color as LinearSrgbColor;
			commandEncoder.beginRenderPass({
				colorAttachments: [{ view, clearValue: { r: r * a, g: g * a, b: b * a, a }, loadOp: 'clear', storeOp: 'store' }],
			}).end();
		},
		dispose() { texture.destroy(); },
	};
};

export default createFillInstance;
