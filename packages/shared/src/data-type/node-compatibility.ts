import { isTextureDataType } from './data-type.ts';
import type { DataType, TextureDataType } from './data-type.ts';

export function getNodeInputDataType(param: { dataType: DataType; canNode?: boolean }): TextureDataType | null {
	return param.canNode && isTextureDataType(param.dataType) ? param.dataType : null;
}

export function areNodeDataTypesCompatible(output: TextureDataType | undefined, input: TextureDataType | null): boolean {
	if (output == null || input == null) return false;
	return output.kind === input.kind || output.kind === 'any' || input.kind === 'any';
}
