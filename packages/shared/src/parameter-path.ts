import { getArrayElementDefinition, getStructFieldDefinitions } from './parameter.ts';
import type { ParameterArrayElement, ParameterDefinition } from './parameter.ts';
import type { ParameterBinding } from './types.ts';

// 配列はindexではなく要素IDで指定する。親までのパスがIDのスコープとなる。
export type ParamPath = readonly [string, ...string[]];

export function paramPathKey(path: ParamPath): string {
	return JSON.stringify(path);
}

export function resolveParameter(defs: Record<string, ParameterDefinition>, params: Record<string, ParameterBinding>, path: ParamPath) {
	let def = defs[path[0]];
	let value = params[path[0]];
	let setValue = (next: ParameterBinding) => { params[path[0]] = next; };
	if (def == null || value == null) throw new Error(`Unknown parameter: ${paramPathKey(path)}`);
	for (const segment of path.slice(1)) {
		if (def.dataType.kind === 'array' && value.inputSource === 'literal' && Array.isArray(value.value)) {
			const element = (value.value as ParameterArrayElement[]).find(element => element.id === segment);
			// 削除済みのIDを、同じindexにある別要素へ読み替えてはいけない。
			if (element == null) throw new Error(`Unknown array element: ${paramPathKey(path)}`);
			def = getArrayElementDefinition(def);
			value = element.binding;
			setValue = next => { element.binding = next; };
		} else if (def.dataType.kind === 'struct' && value.inputSource === 'literal') {
			const fields = value.value as Record<string, ParameterBinding>;
			def = getStructFieldDefinitions(def)[segment];
			value = fields[segment];
			setValue = next => { fields[segment] = next; };
			if (def == null || value == null) throw new Error(`Unknown struct field: ${paramPathKey(path)}`);
		} else {
			throw new Error(`Invalid parameter path: ${paramPathKey(path)}`);
		}
	}
	return { def, value, setValue };
}

export function* walkParameters(defs: Record<string, ParameterDefinition>, params: Record<string, ParameterBinding>): Generator<{
	path: ParamPath; def: ParameterDefinition; value: ParameterBinding;
}> {
	function* walk(def: ParameterDefinition, value: ParameterBinding, path: ParamPath): ReturnType<typeof walkParameters> {
		if (def.dataType.kind === 'array' && value.inputSource === 'literal') {
			for (const element of value.value as ParameterArrayElement[]) {
				yield* walk(getArrayElementDefinition(def), element.binding, [...path, element.id]);
			}
		} else if (def.dataType.kind === 'struct' && value.inputSource === 'literal') {
			for (const [key, field] of Object.entries(getStructFieldDefinitions(def))) {
				yield* walk(field, value.value[key], [...path, key]);
			}
		} else {
			yield { path, def, value };
		}
	}

	for (const [key, def] of Object.entries(defs)) yield* walk(def, params[key] ?? def.defaultValue, [key]);
}
