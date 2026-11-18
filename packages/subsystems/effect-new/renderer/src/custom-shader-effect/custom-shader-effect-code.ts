import type { Resolution } from '@gs/shared/resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/types.ts';

function shaderType(dataType: TextureDataType): string {
	if (dataType.kind === 'scalar') return 'f32';
	if (dataType.kind === 'vector') return 'vec2f';
	return 'vec4f';
}

/** 本文の行と列を診断に使えるよう、生成した型・関数をユーザーのWGSLの後ろへ追加する。 */
export function generateCustomShaderEffectCode(definition: CustomShaderEffect, resolution: Resolution): string {
	const longSide = Math.max(resolution.width, resolution.height);
	const parameters = Object.values(definition.paramDefs);
	const outputs = Object.values(definition.outputDefs);
	return `${definition.code}
struct Output {
${outputs.map(output => `\t${output.nameForReference}: ${shaderType(output.dataType)},`).join('\n')}
};
const gs_resolution = vec2f(${resolution.width}.0, ${resolution.height}.0);
fn get_resolution() -> vec2f { return gs_resolution; }
fn get_pixel_size() -> f32 { return 1.0 / ${longSide}.0; }
${parameters.map((parameter, index) => `fn read_${parameter.nameForReference}(position: vec2f) -> ${shaderType(parameter.dataType)} {
	// 外部に公開する長辺基準の座標から、ShaderInputが読む画像参照座標へ換算する。
	return read_gs_input${index}(position * (2.0 * ${longSide}.0) / gs_resolution);
}`).join('\n')}
struct GsFragmentOutput {
${outputs.map((output, index) => `\t@location(${index}) gs_output${index}: ${shaderType(output.dataType)},`).join('\n')}
};
@fragment fn gs_fragment(@location(0) position: vec2f) -> GsFragmentOutput {
	let output = main(position * gs_resolution / (2.0 * ${longSide}.0));
	return GsFragmentOutput(${outputs.map(output => `output.${output.nameForReference}`).join(', ')});
}`;
}
