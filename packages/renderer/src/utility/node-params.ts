import { getArrayElementDefinition, getStructFieldDefinitions } from '@glitch/shared/parameter.ts';
import type { ParameterDefinition } from '@glitch/shared/parameter.ts';
import type { ParameterBinding } from '@glitch/shared/types.ts';

type ParamPath = (string | number)[];

// コンテナ自身の式は評価しない。literalの子だけを定義に沿ってたどる。
export function mapNodeParam(def: ParameterDefinition, param: ParameterBinding, path: ParamPath,
	mapLeaf: (def: ParameterDefinition, param: ParameterBinding, path: ParamPath) => any): any {
	if (def.dataType.kind === 'array' || def.dataType.kind === 'struct') {
		if (param.inputSource !== 'literal') throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
		if (def.dataType.kind === 'array') {
			if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
			return param.value.map((value: ParameterBinding, index: number) => mapNodeParam(getArrayElementDefinition(def), value, [...path, index], mapLeaf));
		}
		return Object.fromEntries(Object.entries(getStructFieldDefinitions(def)).map(([key, field]) =>
			[key, mapNodeParam(field, param.value[key], [...path, key], mapLeaf)]));
	}
	return mapLeaf(def, param, path);
}

export function* walkNodeParams(defs: Record<string, ParameterDefinition>, params: Record<string, ParameterBinding>): Generator<{
	def: ParameterDefinition; param: ParameterBinding; path: ParamPath;
}> {
	function* walk(def: ParameterDefinition, param: ParameterBinding, path: ParamPath): ReturnType<typeof walkNodeParams> {
		if (def.dataType.kind === 'array' || def.dataType.kind === 'struct') {
			if (param.inputSource !== 'literal') throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
			if (def.dataType.kind === 'array') {
				if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
				for (const [index, value] of param.value.entries()) yield* walk(getArrayElementDefinition(def), value, [...path, index]);
			} else {
				for (const [key, field] of Object.entries(getStructFieldDefinitions(def))) yield* walk(field, param.value[key], [...path, key]);
			}
		} else {
			yield { def, param, path };
		}
	}

	for (const [key, def] of Object.entries(defs)) {
		yield* walk(def, params[key], [key]);
	}
}

export function getEvaluatedParam(params: Record<string, any>, path: ParamPath): any {
	return path.reduce((value, key) => value[key], params);
}
