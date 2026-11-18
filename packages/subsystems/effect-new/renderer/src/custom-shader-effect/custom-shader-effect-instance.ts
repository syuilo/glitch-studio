import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createTextureEffectInstance } from '../texture-effect-instance.ts';
import { generateCustomShaderEffectCode } from './custom-shader-effect-code.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInput, ShaderInputSchema, ShaderInputValues } from '@gs/shared/gpu/shader-input.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/types.ts';
import type { EffectInstance, EffectInstanceOptions } from '../effect-instance.ts';

function outputFormat(dataType: TextureDataType, enable32bitDataTextures: boolean): GPUTextureFormat {
	if (dataType.kind === 'color') return INTERMEDIATE_TEXTURE_FORMAT;
	const channels = dataType.kind === 'scalar' ? 'r' : dataType.kind === 'vector' ? 'rg' : 'rgba';
	return `${channels}${enable32bitDataTextures ? 32 : 16}float`;
}

async function compileFragmentShader(device: GPUDevice, code: string, userCodeLength: number): Promise<GPUShaderModule> {
	// コンパイラの診断はこの配置のrenderに返す。awaitを挟まずにスコープを閉じ、同じDeviceを使う他の配置のエラーを捕捉しない。
	device.pushErrorScope('validation');
	let module: GPUShaderModule;
	let validation: Promise<GPUError | null>;
	try {
		module = device.createShaderModule({ code });
	} finally {
		validation = device.popErrorScope();
	}
	const [compilation, validationError] = await Promise.all([module.getCompilationInfo(), validation]);
	const errors = compilation.messages.filter(message => message.type === 'error');
	if (errors.length > 0) {
		throw new Error(errors.map(message => {
			const location = message.offset < userCodeLength ? `${message.lineNum}:${message.linePos}` : 'Generated shader';
			return `${location}: ${message.message}`;
		}).join('\n'));
	}
	if (validationError != null) throw new Error(validationError.message);
	return module;
}

type CompiledVariant = {
	pipeline: GPURenderPipeline;
	bindings: ReturnType<typeof createShaderInputBindings>;
};

export function createCustomShaderEffectInstance(definition: CustomShaderEffect, options: EffectInstanceOptions): EffectInstance {
	const { device, resolution } = options;
	const parameters = Object.entries(definition.paramDefs);
	const outputs = Object.entries(definition.outputDefs);
	if (outputs.length > device.limits.maxColorAttachments) throw new Error('Custom Shader Effect exceeds GPU color attachment limit');
	const formats = Object.fromEntries(outputs.map(([id, output]) => [id, outputFormat(output.dataType, options.enable32bitDataTextures)]));
	const schema: ShaderInputSchema = Object.fromEntries(parameters.map(([, parameter], index) => [`gs_input${index}`, parameter.dataType.kind]));
	const code = generateCustomShaderEffectCode(definition, resolution);
	return createTextureEffectInstance(options, formats, outputTextures => {
		const vertex = device.createShaderModule({ code: vertexCode });
		const targets = outputs.map(([id]) => ({ format: formats[id] }));
		const colorAttachments: GPURenderPassColorAttachment[] = outputs.map(([id]) => ({
			view: outputTextures[id].view, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store',
		}));
		const createVariant = (key: string, inputs: ShaderInputValues) => {
			let disposed = false;
			let bindings: CompiledVariant['bindings'] | null = null;
			const dispose = () => {
				disposed = true;
				bindings?.dispose();
				bindings = null;
			};
			const compile = async (): Promise<CompiledVariant> => {
				const generated = generateShaderInputs(schema, inputs, 0, 'level0');
				const fragment = await compileFragmentShader(device, `${code}\n${generated.code}`, definition.code.length);
				// 配置を破棄した後や、別の入力構成が必要になった後にGPUリソースを生成しない。
				if (disposed) throw new Error('Custom Shader Effect compilation was superseded');
				const inputBindings = createShaderInputBindings(device, generated);
				bindings = inputBindings;
				try {
					const pipeline = await device.createRenderPipelineAsync({
						layout: device.createPipelineLayout({ bindGroupLayouts: [inputBindings.layout] }),
						vertex: { module: vertex },
						fragment: { module: fragment, entryPoint: 'gs_fragment', targets },
						primitive: { topology: 'triangle-list' },
					});
					return { pipeline, bindings: inputBindings };
				} catch (error) {
					dispose();
					throw error;
				}
			};
			return { key, compilation: compile(), dispose };
		};
		let current: ReturnType<typeof createVariant> | null = null;
		return {
			async render(request) {
				// WGSLの名前と配列順は実装内でのみ使う。配置に保存された値は固定IDで取得する。
				const inputs: ShaderInputValues = Object.fromEntries(parameters.map(([id], index) => [`gs_input${index}`, request.params[id] as ShaderInput]));
				const key = shaderInputVariantKey(schema, inputs);
				if (current?.key !== key) {
					current?.dispose();
					current = createVariant(key, inputs);
				}
				const pending = current;
				const variant = await pending.compilation;
				if (pending !== current) throw new Error('Custom Shader Effect compilation was superseded');
				const bindGroup = variant.bindings.update(inputs, resolution);
				const pass = request.commandEncoder.beginRenderPass({ colorAttachments });
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose() {
				current?.dispose();
				current = null;
			},
		};
	});
}
