import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect-new_shared/custom-shader-effect/custom-shader-effect.ts';

function wgslType(dataType: TextureDataType): string {
	if (dataType.kind === 'scalar') return 'f32';
	if (dataType.kind === 'vector') return 'vec2f';
	return 'vec4f';
}

/** ユーザー本文を先頭に保ち、コンパイラの行・列が編集画面の位置を指すようにする。 */
export function generateCustomShaderEffectCode(customShaderEffect: CustomShaderEffect, outputIds: readonly string[], resolution: Resolution): string {
	const longSide = Math.max(resolution.width, resolution.height);
	// main() は宣言したすべてのメンバーを書ける。GPUの描画先だけを、配置で利用する出力に絞る。
	const outputMembers = Object.values(customShaderEffect.outputDefs).map(output => `\t${output.nameForReference}: ${wgslType(output.dataType)},`);
	const fragmentMembers = outputIds.map((id, index) => `\t@location(${index}) gs_output${index}: ${wgslType(customShaderEffect.outputDefs[id].dataType)},`);
	const returnedOutputs = outputIds.map(id => `output.${customShaderEffect.outputDefs[id].nameForReference}`);
	const inputFunctions = Object.values(customShaderEffect.paramDefs).map((parameter, index) => `
fn read_${parameter.nameForReference}(position: vec2f) -> ${wgslType(parameter.dataType)} {
	return read_gs_input${index}(position * 2.0 * ${longSide}.0 / gs_resolution);
}`);
	return `${customShaderEffect.code}
struct Output {
${outputMembers.join('\n')}
};
const gs_resolution = vec2f(${resolution.width}.0, ${resolution.height}.0);
fn get_resolution() -> vec2f { return gs_resolution; }
fn get_pixel_size() -> f32 { return 1.0 / ${longSide}.0; }
${inputFunctions.join('\n')}
struct GsCustomShaderEffectFragmentOutput {
${fragmentMembers.join('\n')}
};
@fragment fn gs_fragment(@location(0) position: vec2f) -> GsCustomShaderEffectFragmentOutput {
	let output = main(position * gs_resolution / (${longSide}.0 * 2.0));
	return GsCustomShaderEffectFragmentOutput(${returnedOutputs.join(', ')});
}`;
}
