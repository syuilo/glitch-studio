import { isTextureDataType } from './data-type.ts';
import type { DataType, TextureDataType } from './data-type.ts';

export function getNodeInputDataType(param: { dataType: DataType; canNode?: boolean }): TextureDataType | null {
	return param.canNode && isTextureDataType(param.dataType) ? param.dataType : null;
}

// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function areNodeDataTypesCompatible(output: TextureDataType | null | undefined, input: TextureDataType | null): boolean {
	if (output == null || input == null) return false;
	return output.kind === input.kind || output.kind === 'any' || input.kind === 'any';
}
