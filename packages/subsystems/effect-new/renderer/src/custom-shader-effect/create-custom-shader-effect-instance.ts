import { createShaderInputBindings, generateShaderInputs } from '@gs/shared/gpu/shader-input.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { TextureValue } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/custom-shader-effect.ts';
import type { EffectGpuContext, EffectInstance, EffectInstanceOptions } from '../effect-instance.ts';
import { generateCustomShaderEffectCode } from './shader-code.ts';

function outputFormat(dataType: TextureDataType, enable32bitDataTextures: boolean): GPUTextureFormat {
	switch (dataType.kind) {
		case 'color': return INTERMEDIATE_TEXTURE_FORMAT;
		case 'scalar': return enable32bitDataTextures ? 'r32float' : 'r16float';
		case 'vector': return enable32bitDataTextures ? 'rg32float' : 'rg16float';
		case 'any': return enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
	}
}

async function compileModule(device: GPUDevice, code: string, userCodeLength: number): Promise<GPUShaderModule> {
	// 編集途中のWGSLも実行対象になる。診断をデバイス全体の未捕捉エラーにせず、この配置へ返す。
	device.pushErrorScope('validation');
	const module = device.createShaderModule({ code });
	const validation = device.popErrorScope();
	const [compilation, shaderError] = await Promise.all([module.getCompilationInfo(), validation]);
	const errors = compilation.messages.filter(message => message.type === 'error');
	if (errors.length > 0) {
		throw new Error(errors.map(message => {
			const location = message.offset < userCodeLength ? `${message.lineNum}:${message.linePos}` : 'Generated shader';
			return `${location}: ${message.message}`;
		}).join('\n'));
	}
	if (shaderError != null) throw new Error(shaderError.message);
	return module;
}

export async function createCustomShaderEffectInstance(customShaderEffect: CustomShaderEffect, options: EffectInstanceOptions, gpu: EffectGpuContext): Promise<EffectInstance> {
	const { device } = gpu;
	const resolution = { ...options.resolution };
	const inputs = Object.entries(customShaderEffect.paramDefs).map(([id, parameter], index) => {
		const layout = options.inputLayouts[id];
		if (layout?.kind !== 'texture' && layout?.kind !== 'uniform') {
			throw new Error(`Custom Shader Effect input "${id}" requires a uniform or texture layout`);
		}
		return { id, name: `gs_input${index}`, dataType: parameter.dataType.kind, layout };
	});
	if (options.requestedOutputIds.length === 0) return { outputLayouts: {}, render: () => ({}), dispose: () => {} };
	const outputIds = [...options.requestedOutputIds];
	if (outputIds.length > device.limits.maxColorAttachments) throw new Error('Custom Shader Effect exceeds the GPU output limit');
	const targets = outputIds.map(id => ({ format: outputFormat(customShaderEffect.outputDefs[id].dataType, gpu.enable32bitDataTextures) }));
	const generated = generateShaderInputs(
		Object.fromEntries(inputs.map(input => [input.name, input.dataType])),
		Object.fromEntries(inputs.map(input => [input.name, input.layout])),
		0, 'level0',
	);
	const code = generateCustomShaderEffectCode(customShaderEffect, outputIds, resolution) + '\n' + generated.code;
	const module = await compileModule(device, code, customShaderEffect.code.length);
	const bindings = createShaderInputBindings(device, generated);
	const textures: GPUTexture[] = [];
	const dispose = () => {
		bindings.dispose();
		for (const texture of textures) texture.destroy();
	};
	try {
		const pipeline = await device.createRenderPipelineAsync({
			layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
			vertex: { module: gpu.defaultVertexShaderModule },
			fragment: { module, entryPoint: 'gs_fragment', targets },
			primitive: { topology: 'triangle-list' },
		});
		for (const { format } of targets) {
			textures.push(device.createTexture({ size: resolution, format,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC }));
		}
		const colorAttachments: GPURenderPassColorAttachment[] = textures.map(texture => ({
			view: texture.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store',
		}));
		const outputs: Record<string, TextureValue> = Object.fromEntries(outputIds.map((id, index) => [id, { kind: 'texture', texture: textures[index] }]));
		const values: Record<string, ShaderInput> = {};
		return {
			outputLayouts: Object.fromEntries(outputIds.map(id => [id, { kind: 'texture', resolution }])),
			render: frame => {
				for (const input of inputs) values[input.name] = frame.parameters[input.id] as ShaderInput;
				const bindGroup = bindings.update(values, resolution);
				const pass = frame.commandEncoder.beginRenderPass({ colorAttachments });
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
				pass.end();
				return outputs;
			},
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
