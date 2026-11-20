import { createTrailHistory } from '../../trail-history.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues } from '../../multipass.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement, publishOutputs) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const shaderModule = device.createShaderModule({
			code: code,
		});

		const pipeline = device.createRenderPipeline({
			vertex: {
				module: defaultVertexShaderModule,
			},
			fragment: {
				module: shaderModule,
				targets: ['output', 'scalar'].map(id => {
					const texture = outputTextures.get(id);
					return texture == null ? null : { format: texture.format };
				}),
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		const uniformValues = createShaderBuffer(codeUniforms.uniforms);

		const uniformBuffer = device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const history = createTrailHistory(device, resolution, outputTextures, publishOutputs, pipeline, uniformBuffer);

		return {
			render: (ctx) => {
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution),
					timeDelta: ctx.timeDelta,
					radius: params.radius * getSizeReferenceLength(params.sizeReference, resolution) / Math.max(resolution.width, resolution.height),
					strength: params.strength,
					halfLife: Math.max(1, params.halfLife),
					pointerPosition: ctx.pointerPosition ?? [-99999, -99999],
					pointerVector: ctx.pointerVector ?? [0, 0],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				history.draw(ctx.commandEncoder);
			},
			resetRenderHistory() {
				history.reset();
			},
			dispose: () => {
				history.dispose();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
