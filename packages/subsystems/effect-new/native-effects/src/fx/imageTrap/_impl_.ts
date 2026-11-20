import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { IMAGE_TRAP_SPAN_AT_ZOOM_ONE, IMAGE_TRAP_MINIMUM_ZOOM } from './_def_.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const referenceSize = { width: 1, height: 1 };
		uniformValues.set({ spatialHalfExtent: getSpatialHalfExtent(resolution), pixelStep: [2 / resolution.width, 2 / resolution.height] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color', coordinateOffset: 'vector' },
			inputs,
			sampling: 'level0',
			internalLayouts: [layout],
			samplingOverrides: { referenceResolutions: { input: referenceSize } },
			bindResources(pass) {
				const rotation = inputs.view.fields.rotation.value * 2 * Math.PI;
				const trapRotation = inputs.trapRotation.value * 2 * Math.PI;
				const trapSize = inputs.trapSize.value.map(value => Math.max(0.000001, value));
				uniformValues.set({
					complexCenter: inputs.view.fields.center.value,
					juliaConstant: inputs.juliaConstant.value,
					rotation: [Math.cos(rotation), Math.sin(rotation)],
					trapRotation: [Math.cos(trapRotation), Math.sin(trapRotation)],
					trapPosition: inputs.trapPosition.value,
					trapSize,
					complexScale: IMAGE_TRAP_SPAN_AT_ZOOM_ONE / Math.max(IMAGE_TRAP_MINIMUM_ZOOM, inputs.view.fields.zoom.value),
					bailoutRadius: Math.min(1e12, Math.max(2, inputs.bailoutRadius.value)),
					opacity: Math.min(1, Math.max(0, inputs.opacity.value)),
					iterationDecay: Math.min(1, Math.max(0, inputs.iterationDecay.value)),
					firstIteration: Math.min(512, Math.max(1, Math.floor(inputs.firstIteration.value))),
					maximumIterations: Math.min(512, Math.max(1, Math.floor(inputs.maximumIterations.value))),
					formula: inputs.formula.value === 'julia' ? 0 : 1,
					compositeMode: ['firstOnTop', 'lastOnTop', 'maximumAlpha'].indexOf(inputs.compositeMode.value),
					antialiasing: inputs.antialiasing.value ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				referenceSize.width = trapSize[0];
				referenceSize.height = trapSize[1];
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
