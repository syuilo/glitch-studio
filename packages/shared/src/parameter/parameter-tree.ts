import { getArrayElementDefinition, getStructFieldDefinitions } from './parameter-definition.ts';
import { isLiteralParameterBinding } from './parameter-binding.ts';
import type { ParameterArrayElement, ParameterBindingBase } from './parameter-binding.ts';
import type { ParameterDefinition } from './parameter-definition.ts';

// レンダラー内のパスは、この評価で生成する素の配列をたどるためのindexを使う。
// 編集対象を長期的に保持するUIのIDパスとは用途が異なる。
export type EvaluatedParameterPath = (string | number)[];

// コンテナ自身の式は評価しない。literalの子だけを定義に沿ってたどる。
// 親がliteralでも子は式やドメイン固有方式になり得るため、Bindingは親から推論しない。
// 型引数にはツリー全体で許可するBindingを明示する。指定漏れはneverで拒否する。
export function mapParameterTree<Binding extends ParameterBindingBase = never>(def: ParameterDefinition, param: NoInfer<Binding>, path: EvaluatedParameterPath,
	mapLeaf: NoInfer<(def: ParameterDefinition, param: Binding, path: EvaluatedParameterPath) => any>): any {
	if (def.dataType.kind === 'array' || def.dataType.kind === 'struct') {
		if (!isLiteralParameterBinding(param)) throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
		if (def.dataType.kind === 'array') {
			if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
			return param.value.map((element: ParameterArrayElement<Binding>, index: number) => mapParameterTree<Binding>(getArrayElementDefinition(def), element.binding, [...path, index], mapLeaf));
		}
		const fields = param.value as Record<string, Binding>;
		return Object.fromEntries(Object.entries(getStructFieldDefinitions(def)).map(([key, field]) =>
			[key, mapParameterTree<Binding>(field, fields[key], [...path, key], mapLeaf)]));
	}
	return mapLeaf(def, param, path);
}

export function* walkParameterLeaves<Binding extends ParameterBindingBase = never>(defs: Record<string, ParameterDefinition>, params: NoInfer<Record<string, Binding>>): Generator<{
	def: ParameterDefinition; param: Binding; path: EvaluatedParameterPath;
}> {
	function* walk(def: ParameterDefinition, param: Binding, path: EvaluatedParameterPath): ReturnType<typeof walkParameterLeaves<Binding>> {
		if (def.dataType.kind === 'array' || def.dataType.kind === 'struct') {
			if (!isLiteralParameterBinding(param)) throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
			if (def.dataType.kind === 'array') {
				if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
				for (const [index, element] of (param.value as ParameterArrayElement<Binding>[]).entries()) yield* walk(getArrayElementDefinition(def), element.binding, [...path, index]);
			} else {
				const fields = param.value as Record<string, Binding>;
				for (const [key, field] of Object.entries(getStructFieldDefinitions(def))) yield* walk(field, fields[key], [...path, key]);
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
