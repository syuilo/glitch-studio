import { getArrayElementDefinition, getStructFieldDefinitions } from './parameter-definition.ts';
import type { ParameterArrayElement, ParameterBinding } from './parameter-binding.ts';
import type { ParameterDefinition } from './parameter-definition.ts';

// レンダラー内のパスは、この評価で生成する素の配列をたどるためのindexを使う。
// 編集対象を長期的に保持するUIのIDパスとは用途が異なる。
export type EvaluatedParameterPath = (string | number)[];

// コンテナ自身の式は評価しない。literalの子だけを定義に沿ってたどる。
export function mapParameterTree(def: ParameterDefinition, param: ParameterBinding, path: EvaluatedParameterPath,
	mapLeaf: (def: ParameterDefinition, param: ParameterBinding, path: EvaluatedParameterPath) => any): any {
	if (def.dataType.kind === 'array' || def.dataType.kind === 'struct') {
		if (param.inputSource !== 'literal') throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
		if (def.dataType.kind === 'array') {
			if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
			return param.value.map((element: ParameterArrayElement, index: number) => mapParameterTree(getArrayElementDefinition(def), element.binding, [...path, index], mapLeaf));
		}
		return Object.fromEntries(Object.entries(getStructFieldDefinitions(def)).map(([key, field]) =>
			[key, mapParameterTree(field, param.value[key], [...path, key], mapLeaf)]));
	}
	return mapLeaf(def, param, path);
}

export function* walkParameterLeaves(defs: Record<string, ParameterDefinition>, params: Record<string, ParameterBinding>): Generator<{
	def: ParameterDefinition; param: ParameterBinding; path: EvaluatedParameterPath;
}> {
	function* walk(def: ParameterDefinition, param: ParameterBinding, path: EvaluatedParameterPath): ReturnType<typeof walkParameterLeaves> {
		if (def.dataType.kind === 'array' || def.dataType.kind === 'struct') {
			if (param.inputSource !== 'literal') throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
			if (def.dataType.kind === 'array') {
				if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
				for (const [index, element] of (param.value as ParameterArrayElement[]).entries()) yield* walk(getArrayElementDefinition(def), element.binding, [...path, index]);
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

export function getEvaluatedParameterValue(params: Record<string, any>, path: EvaluatedParameterPath): any {
	return path.reduce((value, key) => value[key], params);
}
