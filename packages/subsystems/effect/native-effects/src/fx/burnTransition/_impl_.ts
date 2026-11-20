import colorCode from './color.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, 'inputA' | 'inputB' | 'edgeColor' | 'edgeIntensity'> = {
	init(context) {
		const { device, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		// Mask・Edgeだけの配置では、色の合成用シェーダーを追加せずInput A・Input B・Edge Colorの参照も省く。
		const color = context.outputTextures.has('output');
		const maskInputs = { progress: 'scalar', map: 'scalar' } as const;
		const schema = color ? { ...maskInputs, inputA: 'color', inputB: 'color', edgeColor: 'color' } as const : maskInputs;
		return createFullscreenEffect(context, {
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			code: color ? code + '\n' + colorCode : code,
			schema,
			entryPoint: color ? 'fsColor' : 'fsMaskEdge',
			// WGSLのlocation順を保ち、使わない出力のattachmentだけを空にする。
			outputPorts: ['output', 'mask', 'edge'],
			bindResources(pass) {
				uniformValues.set({
					softness: Math.max(0, inputs.softness.value),
					edgeWidth: Math.max(0, inputs.edgeWidth.value),
					edgeIntensity: color ? Math.max(0, inputs.edgeIntensity!.value) : 0,
					reverse: inputs.reverse.value ? 1 : 0,
					antiAlias: inputs.antiAlias.value ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
