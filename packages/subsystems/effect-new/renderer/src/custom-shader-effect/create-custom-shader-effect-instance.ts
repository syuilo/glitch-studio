import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createShaderInputBindings, generateShaderInputs } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInput, ShaderInputType } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/custom-shader-effect.ts';
import type { EffectInstance, EffectInstanceOptions, EffectRenderContext } from '../effect-instance.ts';

function getOutputFormat(dataType: TextureDataType, enable32bitDataTextures: boolean): GPUTextureFormat {
	if (dataType.kind === 'color') return INTERMEDIATE_TEXTURE_FORMAT;
	if (dataType.kind === 'scalar') return enable32bitDataTextures ? 'r32float' : 'r16float';
	if (dataType.kind === 'vector') return enable32bitDataTextures ? 'rg32float' : 'rg16float';
	return enable32bitDataTextures ? 'rgba32float' : 'rgba16float';
}

function getShaderType(dataType: TextureDataType): string {
	if (dataType.kind === 'scalar') return 'f32';
	if (dataType.kind === 'vector') return 'vec2f';
	return 'vec4f';
}

function generateFragmentCode(definition: CustomShaderEffect, resolution: Resolution): string {
	const parameters = Object.values(definition.paramDefs);
	const outputs = Object.values(definition.outputDefs);
	const [halfWidth, halfHeight] = getSpatialHalfExtent(resolution);
	// 本文を先頭に保ち、GPUコンパイラが返す行と列をそのままエディタで指せるようにする。
	return `${definition.code}
struct Output {
${outputs.map(output => `	${output.nameForReference}: ${getShaderType(output.dataType)},`).join('\n')}
};
const gs_halfExtent = vec2f(${halfWidth}, ${halfHeight});
fn get_resolution() -> vec2f { return vec2f(${resolution.width}, ${resolution.height}); }
fn get_pixel_size() -> f32 { return 1.0 / ${Math.max(resolution.width, resolution.height)}.0; }
${parameters.map((parameter, index) => `fn read_${parameter.nameForReference}(position: vec2f) -> ${getShaderType(parameter.dataType)} {
	return read_gs_input${index}(position / gs_halfExtent);
}`).join('\n')}
struct gs_FragmentOutput {
${outputs.map((output, index) => `	@location(${index}) gs_output${index}: ${getShaderType(output.dataType)},`).join('\n')}
};
@fragment fn gs_fragment(@location(0) position: vec2f) -> gs_FragmentOutput {
	let output = main(position * gs_halfExtent);
	return gs_FragmentOutput(${outputs.map(output => `output.${output.nameForReference}`).join(', ')});
}`;
}

export async function createCustomShaderEffectInstance(definition: CustomShaderEffect, options: EffectInstanceOptions): Promise<EffectInstance> {
	const { device, resolution } = options;
	const outputs = Object.entries(definition.outputDefs);
	if (outputs.length > device.limits.maxColorAttachments) throw new Error('Custom Shader Effect exceeds the GPU output limit');
	const formats = outputs.map(([, output]) => getOutputFormat(output.dataType, options.enable32bitDataTextures === true));
	const parameters = Object.entries(definition.paramDefs);
	const schema: Record<string, ShaderInputType> = {};
	const inputShapes: Record<string, Pick<ShaderInput, 'kind'>> = {};
	for (const [index, [id, parameter]] of parameters.entries()) {
		const kind = options.inputKinds[id];
		if (kind !== 'texture' && kind !== 'uniform') throw new Error(`Custom Shader Effect requires an input kind for ${id}`);
		const shaderName = `gs_input${index}`;
		schema[shaderName] = parameter.dataType.kind;
		inputShapes[shaderName] = { kind };
	}
	// 入力種別は配置の寿命中固定。uniformだけで渡すパラメータにtexture/samplerを割り当てない。
	const generated = generateShaderInputs(schema, inputShapes, 0, 'level0');
	const bindings = createShaderInputBindings(device, generated);
	const textures = new Map<string, GPUTexture>();
	const dispose = () => {
		for (const texture of textures.values()) texture.destroy();
		bindings.dispose();
	};
	try {
		// WGSLの編集中は構文エラーが発生し得る。Device全体への未捕捉エラーにせず、生成の失敗として返す。
		const code = generateFragmentCode(definition, resolution) + '\n' + generated.code;
		device.pushErrorScope('validation');
		const module = device.createShaderModule({ code });
		const validation = device.popErrorScope();
		const [compilation, validationError] = await Promise.all([module.getCompilationInfo(), validation]);
		const errors = compilation.messages.filter(message => message.type === 'error');
		if (errors.length > 0) {
			throw new Error(errors.map(message => `${message.offset < definition.code.length ? `${message.lineNum}:${message.linePos}` : 'Generated shader'}: ${message.message}`).join('\n'));
		}
		if (validationError != null) throw new Error(validationError.message);
		const pipeline = await device.createRenderPipelineAsync({
			layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
			vertex: { module: device.createShaderModule({ code: vertexCode }) },
			fragment: { module, entryPoint: 'gs_fragment', targets: formats.map(format => ({ format })) },
			primitive: { topology: 'triangle-list' },
		});
		const attachments: GPURenderPassColorAttachment[] = [];
		for (const [index, [id]] of outputs.entries()) {
			const texture = device.createTexture({
				label: `Custom Shader Effect output ${id}`, size: resolution, format: formats[index],
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
			});
			textures.set(id, texture);
			attachments.push({ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] });
		}
		return {
			getOutputKind: outputId => textures.has(outputId) ? 'texture' : null,
			getOutputResolution: outputId => textures.has(outputId) ? resolution : null,
			render({ commandEncoder, params, requestedOutputIds }: EffectRenderContext & { params: Readonly<Record<string, ShaderInput>> }) {
				const results = new Map<string, UniformOrTexture>();
				for (const id of requestedOutputIds) {
					const texture = textures.get(id);
					if (texture != null) results.set(id, { kind: 'texture', texture });
				}
				if (results.size === 0) return results;
				const values = Object.fromEntries(parameters.map(([id], index) => [`gs_input${index}`, params[id]]));
				const group = bindings.update(values, resolution);
				const pass = commandEncoder.beginRenderPass({ colorAttachments: attachments });
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, group);
				pass.draw(3);
				pass.end();
				return results;
			},
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
