import { createTrailHistory } from '../../trail-history.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { bindParameterValues } from '../../multipass.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement, publishOutputs) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const shaderModule = device.createShaderModule({ code });
		const pipeline = device.createRenderPipeline({
			vertex: { module: defaultVertexShaderModule },
			fragment: {
				module: shaderModule,
				targets: ['output', 'scalar'].map(id => {
					const texture = outputTextures.get(id);
					return texture == null ? null : { format: texture.format };
				}),
			},
			primitive: { topology: 'triangle-list' },
			layout: 'auto',
		});
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({
			size: uniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const history = createTrailHistory(device, resolution, outputTextures, publishOutputs, pipeline, uniformBuffer);

		let previousPosition: readonly [number, number] | null = null;

		return {
			render: ctx => {
				const position = params.position;
				const positionDelta = previousPosition == null ? [0, 0] : [position[0] - previousPosition[0], position[1] - previousPosition[1]];
				uniformValues.set({
					halfExtent: getSpatialHalfExtent(resolution),
					timeDelta: ctx.timeDelta,
					radius: params.radius * getSizeReferenceLength(params.sizeReference, resolution) / Math.max(resolution.width, resolution.height),
					strength: params.strength,
					halfLife: Math.max(1, params.halfLife),
					position,
					positionDelta,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

				history.draw(ctx.commandEncoder);
				// パラメータ配列そのものを保持すると、呼び出し側の更新で移動元まで変わる可能性がある。
				previousPosition = [position[0], position[1]];
			},
			resetRenderHistory() {
				history.reset();
				previousPosition = null;
			},
			dispose: () => {
				history.dispose();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
