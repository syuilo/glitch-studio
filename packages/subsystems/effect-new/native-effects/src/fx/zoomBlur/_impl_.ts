import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { createZoomBlurTaps, getZoomBlurSampleCount } from './sampling.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const tapTableValues = createShaderBuffer(codeUniforms.tapTable);
		const tapTableBuffer = device.createBuffer({ size: tapTableValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
		] });
		const bindGroup = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: tapTableBuffer } },
		] });

		const halfExtent = getSpatialHalfExtent(resolution);
		let previousSampleCount: number | null = null;
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', strength: 'scalar', focusRadius: 'scalar', dispersion: 'scalar', dispersionFalloff: 'scalar', bias: 'scalar', highlights: 'scalar', spiral: 'scalar', jitter: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const sampleCount = getZoomBlurSampleCount(inputs.samples.value);
				if (sampleCount !== previousSampleCount) {
					tapTableValues.set({ taps: createZoomBlurTaps(sampleCount) });
					device.queue.writeBuffer(tapTableBuffer, 0, tapTableValues.arrayBuffer);
					previousSampleCount = sampleCount;
				}
				uniformValues.set({
					center: inputs.center.value,
					halfExtent,
					// 分散の距離比は最遠の隅を1とする。Focus Radiusは独立した寸法であり、
					// 中心を画面外へ動かしても保護領域の実際の大きさを変えない。
					maximumDistance: Math.hypot(halfExtent[0] + Math.abs(inputs.center.value[0]), halfExtent[1] + Math.abs(inputs.center.value[1])),
					referenceScale: getSizeReferenceLength(inputs.sizeReference.value, resolution) / Math.max(resolution.width, resolution.height),
					samples: sampleCount,
					seed: Math.trunc(inputs.seed.value) >>> 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() {
				uniformBuffer.destroy();
				tapTableBuffer.destroy();
			},
		});
	},
};

export default implementation;
