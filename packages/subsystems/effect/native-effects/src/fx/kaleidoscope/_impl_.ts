import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			// 中心と折り目では角度の微分が不安定になるため、LOD 0で入力を読む。
			sampling: 'level0',
			bindResources(pass) {
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				uniformValues.set({
					center: spatialToNormalizedCoordinates(inputs.center.value, resolution),
					sourceCenter: spatialToNormalizedCoordinates(inputs.sourceCenter.value, resolution),
					coordinateScale: [resolution.width / referenceLength * 0.5, resolution.height / referenceLength * 0.5],
					// 式やキーから小数が渡っても全周が閉じるよう、1以上の整数にする。
					sectorAngle: 2 * Math.PI / Math.max(1, Math.round(inputs.repetitions.value)),
					mirror: inputs.mirror.value ? 1 : 0,
					angularSkew: Math.max(-1, Math.min(1, inputs.angularSkew.value)),
					rotation: inputs.rotation.value * (2 * Math.PI),
					twist: inputs.twist.value * (2 * Math.PI),
					radialRepeat: Math.max(0, inputs.radialRepeat.value),
					// 大きな位相をGPUへ渡して半径方向の細かな差が失われないよう、周期内へ戻す。
					radialPhase: inputs.radialPhase.value - Math.floor(inputs.radialPhase.value),
					sourceRotation: inputs.sourceRotation.value * (2 * Math.PI),
					// Zoomは正の拡大率。UI範囲外の値でもゼロ除算を起こさない。
					zoom: Math.max(0.000001, inputs.zoom.value),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
