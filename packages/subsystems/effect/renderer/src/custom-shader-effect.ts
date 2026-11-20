import { createShaderInputBindings, generateShaderInputs } from '@gs/shared/gpu/shader-input.ts';
import { toFixedShaderInput } from './effect-instance.ts';
import type { FixedShaderInput, ShaderInputType } from '@gs/shared/gpu/shader-input.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import type { EffectImageInput, EffectInitContext, EffectRenderOperation } from './effect-instance.ts';

const wgslTypes = { scalar: 'f32', vector: 'vec2f', color: 'vec4f', any: 'vec4f' } as const;

export async function initCustomShaderEffect(definition: CustomShaderEffect, context: EffectInitContext): Promise<EffectRenderOperation> {
	const { device, resolution } = context;
	const schema: Record<string, ShaderInputType> = Object.create(null);
	const inputs: Record<string, FixedShaderInput> = Object.create(null);
	const readers: string[] = [];
	const longSide = Math.max(resolution.width, resolution.height);
	for (const [id, parameter] of Object.entries(definition.paramDefs)) {
		const key = 'gs_input' + readers.length;
		schema[key] = parameter.dataType.kind;
		inputs[key] = toFixedShaderInput(context.inputs[id] as EffectImageInput);
		readers.push(`fn read_${parameter.nameForReference}(position: vec2f) -> ${wgslTypes[parameter.dataType.kind]} {
	return read_${key}(position * ${longSide * 2}.0 / gs_resolution);
}`);
	}
	const generated = generateShaderInputs(schema, inputs, 0, 'level0');
	const outputs = [...context.outputTextures].map(([id, texture]) => ({ definition: definition.outputDefs[id], texture }));
	// ユーザー関数は常に完全なOutputを返す。描画先とfragmentのlocationだけを使用ポートに絞る。
	const code = `${definition.code}
struct Output {
${Object.values(definition.outputDefs).map(output => `	${output.nameForReference}: ${wgslTypes[output.dataType.kind]},`).join('\n')}
};
const gs_resolution = vec2f(${resolution.width}.0, ${resolution.height}.0);
fn get_resolution() -> vec2f { return gs_resolution; }
fn get_pixel_size() -> f32 { return 1.0 / ${longSide}.0; }
${readers.join('\n')}
struct GsFragmentOutput {
${outputs.map(({ definition: output }, i) => `	@location(${i}) gs_output${i}: ${wgslTypes[output.dataType.kind]},`).join('\n')}
};
@fragment fn gs_fragment(@location(0) position: vec2f) -> GsFragmentOutput {
	let output = main(position * gs_resolution / ${2 * longSide}.0);
	return GsFragmentOutput(${outputs.map(({ definition: output }) => `output.${output.nameForReference}`).join(', ')});
}
${generated.code}`;
	// 本文を先頭に置き、未完成のWGSLの診断を編集画面と同じ行・列で返す。
	device.pushErrorScope('validation');
	const module = device.createShaderModule({ code });
	const [error, compilation] = await Promise.all([device.popErrorScope(), module.getCompilationInfo()]);
	const errors = compilation.messages.filter(message => message.type === 'error');
	if (errors.length > 0) throw new Error(errors.map(message => `${message.offset < definition.code.length ? `${message.lineNum}:${message.linePos}` : 'Generated shader'}: ${message.message}`).join('\n'));
	if (error != null) throw new Error(error.message);
	const bindings = createShaderInputBindings(device, generated);
	try {
		const getBindGroup = bindings.bindFixedInputs(inputs, resolution);
		const pipeline = await device.createRenderPipelineAsync({
			layout: device.createPipelineLayout({ bindGroupLayouts: [bindings.layout] }),
			vertex: { module: context.defaultVertexShaderModule },
			fragment: { module, entryPoint: 'gs_fragment', targets: outputs.map(({ texture }) => ({ format: texture.format })) },
			primitive: { topology: 'triangle-list' },
		});
		const colorAttachments: GPURenderPassColorAttachment[] = outputs.map(({ texture }) => ({
			view: texture.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store',
		}));
		return {
			cacheKey: 0,
			render(frame) {
				const group = getBindGroup();
				const pass = frame.commandEncoder.beginRenderPass({ colorAttachments });
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, group);
				pass.draw(3);
				pass.end();
			},
			dispose: bindings.dispose,
		};
	} catch (error) {
		bindings.dispose();
		throw error;
	}
}
