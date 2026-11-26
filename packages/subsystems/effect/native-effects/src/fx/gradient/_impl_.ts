import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createFunctionCurveBindings } from '@gs/shared/gpu/function-curve.ts';
import { getSpatialHalfExtent, spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const interpolationCurveBindings = createFunctionCurveBindings(device, 1);
		const vector = context.outputTextures.get('vector');
		uniformValues.set({
			halfExtent: getSpatialHalfExtent(resolution),
		});
		return createFullscreenEffect(context, {
			code: interpolationCurveBindings.shaderCode + '\n' + code,
			inputs,
			internalLayouts: [layout, interpolationCurveBindings.layout],
			sampling: 'level0',
			scalarGradients: true,
			schema: { startPosition: 'scalar', endPosition: 'scalar', startValue: 'scalar', endValue: 'scalar', frequency: 'scalar', phase: 'scalar', skew: 'scalar' },
			outputPorts: vector == null ? ['scalar'] : ['scalar', 'vector'],
			entryPoint: vector == null ? 'fs' : 'fsWithGradient',
			constants: vector == null ? { CALCULATE_GRADIENT: 0 } : {
				CALCULATE_GRADIENT: 1,
				MAX_GRADIENT: vector.format === 'rg32float' ? 3.4028234663852886e38 : 65504,
			},
			bindResources(pass) {
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				uniformValues.set({
					mode: inputs.mode.value === 'radial' ? 1 : 0,
					center: spatialToNormalizedCoordinates(inputs.center.value, resolution),
					coordinateScale: [resolution.width / referenceLength, resolution.height / referenceLength],
					angle: inputs.angle.value * (2 * Math.PI), // turnをラジアンへ変換。正の角度で時計回り。
					clampEdge: inputs.clampEdge.value ? 1 : 0,
					mirrorRepeat: inputs.mirrorRepeat.value ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
				pass.setBindGroup(1, interpolationCurveBindings.update(inputs.interpolation.value));
			},
			disposeResources() {
				uniformBuffer.destroy();
				interpolationCurveBindings.dispose();
			},
		});
	},
};

export default implementation;
