import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createNativeEffectInputBindings } from '../../shader-input.ts';
import code, { uniforms } from './shader.shader.ts?shader';
import colorCode from './color.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, 'input' | 'strength'> = {
	async init({ device, resolution, inputs, outputTextures, defaultVertexShaderModule }) {
		const color = outputTextures.get('output');
		const mask = outputTextures.get('mask');
		// 要求順にかかわらず、2出力の場合はcolorをlocation 0に置く。Mask単独時のlocationは0。
		const targets = [color, mask].filter(texture => texture != null);
		const descriptor: GPURenderPassDescriptor = {
			colorAttachments: targets.map(texture => ({ view: texture.createView(), loadOp: 'clear', storeOp: 'store' })),
		};
		const values = createShaderBuffer(uniforms.uniforms);
		const longSide = Math.max(resolution.width, resolution.height);
		values.set({ halfExtent: getSpatialHalfExtent(resolution) });
		const halfSize = [0, 0];
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const buffer = device.createBuffer({ size: values.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		let inputBindings: ReturnType<typeof createNativeEffectInputBindings> | null = null;

		function dispose(): void {
			inputBindings?.dispose();
			buffer.destroy();
		}

		try {
			if (color != null) inputBindings = createNativeEffectInputBindings({
				device, resolution, schema: { input: 'color' }, inputs: { input: inputs.input! }, group: 1, sampling: 'level0',
			});
			const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] });
			const pipeline = await device.createRenderPipelineAsync({
				layout: device.createPipelineLayout({ bindGroupLayouts: inputBindings == null ? [layout] : [layout, inputBindings.layout] }),
				vertex: { module: defaultVertexShaderModule },
				fragment: {
					module: device.createShaderModule({ code: inputBindings == null ? code : [code, inputBindings.code, colorCode].join('\n') }),
					entryPoint: color == null ? 'fs_mask' : mask == null ? 'fs_color' : 'fs_color_mask',
					targets: targets.map(texture => ({ format: texture.format })),
				},
			});
			return {
				cacheKey: 0,
				render({ commandEncoder }) {
					const scale = getSizeReferenceLength(inputs.sizeReference.value, resolution) / longSide;
					const size = inputs.size.value;
					halfSize[0] = size[0] * 0.5 * scale;
					halfSize[1] = size[1] * 0.5 * scale;
					values.set({
						center: inputs.center.value, halfSize, rotation: (inputs.rotation.value % 1) * (2 * Math.PI),
						feather: Math.max(0, inputs.feather.value) * scale, strength: Math.max(0, Math.min(1, inputs.strength?.value ?? 0)),
					});
					device.queue.writeBuffer(buffer, 0, values.arrayBuffer);
					const inputGroup = inputBindings?.getBindGroup();
					const pass = commandEncoder.beginRenderPass(descriptor);
					pass.setPipeline(pipeline);
					pass.setBindGroup(0, group);
					if (inputGroup != null) pass.setBindGroup(1, inputGroup);
					pass.draw(3);
					pass.end();
				},
				dispose,
			};
		} catch (error) {
			dispose();
			throw error;
		}
	},
};

export default implementation;
