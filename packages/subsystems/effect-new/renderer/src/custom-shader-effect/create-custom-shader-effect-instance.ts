import { createFixedShaderInputBindings } from '@gs/shared/gpu/shader-input.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInputType } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/types.ts';
import type { EffectFrame, EffectImageInput, EffectInstance, EffectInstanceOptions, EffectTextureOutput } from '../effect-instance.ts';

function shaderValueType(dataType: TextureDataType): string {
	return dataType.kind === 'scalar' ? 'f32' : dataType.kind === 'vector' ? 'vec2f' : 'vec4f';
}

function outputFormat(dataType: TextureDataType, enable32bitDataTextures: boolean): GPUTextureFormat {
	if (dataType.kind === 'color') return INTERMEDIATE_TEXTURE_FORMAT;
	const channels = dataType.kind === 'scalar' ? 'r' : dataType.kind === 'vector' ? 'rg' : 'rgba';
	return `${channels}${enable32bitDataTextures ? 32 : 16}float` as GPUTextureFormat;
}

function generateCustomShaderEffectCode(definition: CustomShaderEffect, resolution: Resolution,
	usedOutputs: CustomShaderEffect['outputDefs'], inputCode: string): string {
	const longSide = Math.max(resolution.width, resolution.height);
	// 入出力の公開名はユーザーが記述したmainの契約。未使用の出力もOutput構造体では宣言し、
	// 実際のfragmentのlocationと描画先だけを詰める。ユーザー本文を先頭に置き診断の行番号を保つ。
	return `${definition.code}
struct Output {
${definition.outputDefs.map(output => `\t${output.nameForReference}: ${shaderValueType(output.dataType)},`).join('\n')}
};
const gs_resolution = vec2f(${resolution.width}.0, ${resolution.height}.0);
fn get_resolution() -> vec2f { return gs_resolution; }
fn get_pixel_size() -> f32 { return 1.0 / ${longSide}.0; }
${definition.paramDefs.map((parameter, index) => `fn read_${parameter.nameForReference}(position: vec2f) -> ${shaderValueType(parameter.dataType)} {
	return read_gs_input${index}(position * 2.0 * ${longSide}.0 / gs_resolution);
}`).join('\n')}
struct GsFragmentOutput {
${usedOutputs.map((output, index) => `\t@location(${index}) gs_output${index}: ${shaderValueType(output.dataType)},`).join('\n')}
};
@fragment fn gs_fragment(@location(0) position: vec2f) -> GsFragmentOutput {
	let output = main(position * gs_resolution / (${longSide}.0 * 2.0));
	return GsFragmentOutput(${usedOutputs.map(output => `output.${output.nameForReference}`).join(', ')});
}
${inputCode}`;
}

export async function createCustomShaderEffectInstance(definition: CustomShaderEffect, options: EffectInstanceOptions): Promise<EffectInstance<EffectTextureOutput>> {
	const usedOutputs = definition.outputDefs.filter(output => options.usedOutputPorts.has(output.id));
	if (usedOutputs.length === 0) return { outputs: {}, render() {}, dispose() {} };
	const { gpu: { device, defaultVertexShaderModule, enable32bitDataTextures }, resolution } = options;
	if (usedOutputs.length > device.limits.maxColorAttachments) throw new Error('Custom Shader Effect exceeds the GPU output limit');
	const schema: Record<string, ShaderInputType> = {};
	const inputs: Record<string, EffectImageInput> = {};
	for (const [index, parameter] of definition.paramDefs.entries()) {
		const name = `gs_input${index}`;
		schema[name] = parameter.dataType.kind;
		const input = options.inputs[parameter.id];
		if (input?.kind !== 'uniform' && input?.kind !== 'texture') throw new Error(`Custom Shader Effect input ${parameter.id} requires a fixed uniform or texture source`);
		inputs[name] = input;
	}
	const bindings = definition.paramDefs.length > 0 ? createFixedShaderInputBindings<EffectFrame>(device, schema, inputs, resolution) : null;
	const textures: GPUTexture[] = [];
	const dispose = () => {
		bindings?.dispose();
		for (const texture of textures) texture.destroy();
	};
	try {
		const code = generateCustomShaderEffectCode(definition, resolution, usedOutputs, bindings?.code ?? '');
		// シェーダー検証のスコープはawaitの前に閉じる。同じDevice上で並行する配置の診断を混ぜない。
		device.pushErrorScope('validation');
		let module: GPUShaderModule;
		let validation: Promise<GPUError | null>;
		try {
			module = device.createShaderModule({ code });
		} finally {
			validation = device.popErrorScope();
		}
		const [compilation, shaderError] = await Promise.all([module.getCompilationInfo(), validation]);
		const errors = compilation.messages.filter(message => message.type === 'error');
		if (errors.length > 0) throw new Error(errors.map(message =>
			`${message.offset < definition.code.length ? `${message.lineNum}:${message.linePos}` : 'Generated shader'}: ${message.message}`
		).join('\n'));
		if (shaderError != null) throw new Error(shaderError.message);
		const targets = usedOutputs.map(output => ({ format: outputFormat(output.dataType, enable32bitDataTextures) }));
		const pipeline = await device.createRenderPipelineAsync({
			layout: device.createPipelineLayout({ bindGroupLayouts: bindings == null ? [] : [bindings.layout] }),
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, entryPoint: 'gs_fragment', targets },
			primitive: { topology: 'triangle-list' },
		});
		const outputs: Record<string, EffectTextureOutput> = Object.create(null);
		const colorAttachments: GPURenderPassColorAttachment[] = [];
		for (const [index, output] of usedOutputs.entries()) {
			const texture = device.createTexture({
				size: resolution, format: targets[index].format,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
			});
			textures.push(texture);
			const value = { kind: 'texture', texture } as const;
			outputs[output.id] = { kind: 'texture', resolution, read: () => value };
			colorAttachments.push({ view: texture.createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' });
		}
		const passDescriptor = { colorAttachments };
		return {
			outputs,
			render(frame) {
				const bindGroup = bindings?.update(frame);
				const pass = frame.commandEncoder.beginRenderPass(passDescriptor);
				pass.setPipeline(pipeline);
				if (bindGroup != null) pass.setBindGroup(0, bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
