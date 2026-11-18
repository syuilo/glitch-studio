import { createShaderInputBindings, generateShaderInputs, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectRenderEnvironment, EffectRenderInstance } from '../effect-render-instance.ts';

function shaderValueType(kind: TextureDataType['kind']) {
	return kind === 'scalar' ? 'f32' : kind === 'vector' ? 'vec2f' : 'vec4f';
}

function outputTextureFormat(kind: TextureDataType['kind'], use32BitData: boolean): GPUTextureFormat {
	if (kind === 'color') return INTERMEDIATE_TEXTURE_FORMAT;
	const channels = kind === 'scalar' ? 'r' : kind === 'vector' ? 'rg' : 'rgba';
	return `${channels}${use32BitData ? 32 : 16}float`;
}

export function createCustomShaderEffectRenderInstance(customShaderEffect: CustomShaderEffect, environment: EffectRenderEnvironment, resolution: Resolution): EffectRenderInstance {
	const { device } = environment;
	const inputs = Object.entries(customShaderEffect.paramDefs).map(([id, parameter], index) => ({
		id, name: customShaderEffect.inputNames[id], internalName: `gs_input${index}`, kind: parameter.dataType.kind,
	}));
	const outputs = Object.entries(customShaderEffect.outputDefs).map(([id, output]) => ({
		id, name: customShaderEffect.outputNames[id], type: shaderValueType(output.dataType.kind),
		format: outputTextureFormat(output.dataType.kind, environment.enable32bitDataTextures === true),
	}));
	if (outputs.length > device.limits.maxColorAttachments) throw new Error('Too many Custom Shader Effect output attachments');
	const inputSchema: Record<string, TextureDataType['kind']> = Object.fromEntries(inputs.map(input => [input.internalName, input.kind]));
	inputSchema.gs_time = 'scalar';
	const uniformInputs: Record<string, ShaderInput> = Object.fromEntries(Object.keys(inputSchema).map(name => [name, { kind: 'uniform', value: [0] }]));
	const halfExtent = getSpatialHalfExtent(resolution);
	// ユーザー本文を先頭に置くとドライバーの診断行・列をそのまま表示できる。
	// ポートIDにはWGSLで使えない文字も含められるため、本文との境界だけ公開識別子を使用する。
	const code = `${customShaderEffect.code}
struct Output {
	${outputs.map(output => `${output.name}: ${output.type},`).join('\n\t')}
}
const gs_half_extent = vec2f(${halfExtent[0]}, ${halfExtent[1]});
fn get_resolution() -> vec2f { return vec2f(${resolution.width}, ${resolution.height}); }
fn get_pixel_size() -> f32 { return 1.0 / ${Math.max(resolution.width, resolution.height)}.0; }
fn get_time() -> f32 { return read_gs_time(vec2f(0)); }
${inputs.map(input => `fn read_${input.name}(position: vec2f) -> ${shaderValueType(input.kind)} {
	return read_${input.internalName}(position / gs_half_extent);
}`).join('\n')}
struct GsFragmentOutputs {
	${outputs.map((output, index) => `@location(${index}) port${index}: ${output.type},`).join('\n\t')}
}
@fragment fn gs_fragment(@location(0) normalized: vec2f) -> GsFragmentOutputs {
	let result = main(normalized * gs_half_extent);
	return GsFragmentOutputs(${outputs.map(output => `result.${output.name}`).join(', ')});
}`;
	const vertex = device.createShaderModule({ code: vertexCode });
	const textures = new Map<string, GPUTexture>();
	const attachments: GPURenderPassColorAttachment[] = [];
	let destroyed = false;
	let preparation: Promise<void> | null = null;
	let compilationError: Error | null = null;
	type Program = {
		key: string;
		module: GPUShaderModule;
		descriptor: GPURenderPipelineDescriptor;
		pipeline: GPURenderPipeline | null;
		bindings: ReturnType<typeof createShaderInputBindings>;
	};
	let uniformProgram: Program | null = null;
	let textureProgram: Program | null = null;

	function programFor(values: Record<string, ShaderInput>): Program {
		const key = shaderInputVariantKey(inputSchema, values);
		if (uniformProgram?.key === key) return uniformProgram;
		if (textureProgram?.key === key) return textureProgram;
		const generated = generateShaderInputs(inputSchema, values, 0, 'level0');
		const module = device.createShaderModule({ code: code + '\n' + generated.code });
		const bindings = createShaderInputBindings(device, generated);
		try {
			const descriptor: GPURenderPipelineDescriptor = {
				layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
				vertex: { module: vertex },
				fragment: { module, entryPoint: 'gs_fragment', targets: outputs.map(output => ({ format: output.format })) },
			};
			const program = { key, module, descriptor, bindings, pipeline: null };
			if (Object.values(values).every(input => input.kind === 'uniform')) {
				uniformProgram = program;
			} else {
				textureProgram?.bindings.dispose();
				textureProgram = program;
			}
			return program;
		} catch (error) {
			bindings.dispose();
			throw error;
		}
	}

	async function preparePipeline() {
		// 配線先・当該フレームの評価値を得る前でも、同じ公開関数と出力を持つ定数入力版で
		// WGSLの型・構文・デバイスの描画制限を診断できる。非同期処理中にscopeを開いたままにしない。
		device.pushErrorScope('validation');
		let program: Program;
		let validation: Promise<GPUError | null>;
		try {
			program = programFor(uniformInputs);
		} finally {
			validation = device.popErrorScope();
		}
		const [info, validationError] = await Promise.all([program.module.getCompilationInfo(), validation]);
		const errors = info.messages.filter(message => message.type === 'error');
		if (errors.length > 0) throw new Error(errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
		if (validationError != null) throw new Error(validationError.message);
		if (destroyed) throw new Error('Custom Shader Effect instance was destroyed');
		const pipeline = await device.createRenderPipelineAsync(program.descriptor);
		if (destroyed) throw new Error('Custom Shader Effect instance was destroyed');
		program.pipeline = pipeline;
	}

	return {
		getOutputResolution: id => Object.hasOwn(customShaderEffect.outputDefs, id) ? { ...resolution } : null,
		prepare(outputIds) {
			if (destroyed) return Promise.reject(new Error('Custom Shader Effect instance was destroyed'));
			if (outputIds.size === 0) return Promise.resolve();
			preparation ??= preparePipeline().catch(error => {
				compilationError = error instanceof Error ? error : new Error(String(error));
				throw compilationError;
			});
			return preparation;
		},
		render(request) {
			if (destroyed) throw new Error('Custom Shader Effect instance was destroyed');
			if (compilationError != null) throw compilationError;
			const result = new Map<string, UniformOrTexture>();
			if (request.outputIds.size === 0) return result;
			const values: Record<string, ShaderInput> = { gs_time: { kind: 'uniform', value: [request.time] } };
			for (const input of inputs) {
				const value = request.parameters.get(input.id);
				if (value == null || typeof value !== 'object' || !('kind' in value) || (value.kind !== 'uniform' && value.kind !== 'texture')) {
					throw new Error(`Unresolved shader input: ${input.id}`);
				}
				values[input.internalName] = value as ShaderInput;
			}
			const program = programFor(values);
			program.pipeline ??= device.createRenderPipeline(program.descriptor);
			const bindGroup = program.bindings.update(values, resolution);
			// mainは1回の実行で複数の値を返す。これらを同じパスで描き、呼び出し元には要求ポートだけを貸す。
			for (const output of outputs) {
				let texture = textures.get(output.id);
				if (texture == null) {
					texture = device.createTexture({ size: resolution, format: output.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
					try {
						attachments.push({ view: texture.createView(), loadOp: 'clear', storeOp: 'store' });
					} catch (error) {
						texture.destroy();
						throw error;
					}
					textures.set(output.id, texture);
				}
				if (request.outputIds.has(output.id)) result.set(output.id, { kind: 'texture', texture });
			}
			const pass = request.commandEncoder.beginRenderPass({ colorAttachments: attachments });
			pass.setPipeline(program.pipeline);
			pass.setBindGroup(0, bindGroup);
			pass.draw(3);
			pass.end();
			return result;
		},
		resetRenderHistory() {},
		destroy() {
			destroyed = true;
			uniformProgram?.bindings.dispose();
			textureProgram?.bindings.dispose();
			uniformProgram = null;
			textureProgram = null;
			for (const texture of textures.values()) texture.destroy();
			textures.clear();
			attachments.length = 0;
		},
	};
}
