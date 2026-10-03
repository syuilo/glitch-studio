import { getArrayElementDefinition, getStructFieldDefinitions } from './parameter-definition.ts';
import { isLiteralParameterBinding } from './parameter-binding.ts';
import type { ParameterArrayElement, ParameterBindingBase } from './parameter-binding.ts';
import type { ValueParameterBinding } from './value-parameter-binding.ts';
import type { ParameterDefinition } from './parameter-definition.ts';

// 配列はindexではなく要素IDで指定する。親までのパスがIDのスコープとなる。
export type ParamPath = readonly [string, ...string[]];

export function paramPathKey(path: ParamPath): string {
	return JSON.stringify(path);
}

export function resolveParameter<Binding extends ParameterBindingBase>(defs: Record<string, ParameterDefinition>, params: Record<string, Binding>, path: ParamPath) {
	let def = defs[path[0]];
	let value = params[path[0]];
	let setValue = (next: NoInfer<Binding>) => { params[path[0]] = next; };
	if (def == null || value == null) throw new Error(`Unknown parameter: ${paramPathKey(path)}`);
	for (const segment of path.slice(1)) {
		if (def.dataType.kind === 'array' && isLiteralParameterBinding(value) && Array.isArray(value.value)) {
			const element = (value.value as ParameterArrayElement<Binding>[]).find(element => element.id === segment);
			// 削除済みのIDを、同じindexにある別要素へ読み替えてはいけない。
			if (element == null) throw new Error(`Unknown array element: ${paramPathKey(path)}`);
			def = getArrayElementDefinition(def);
			value = element.binding;
			setValue = next => { element.binding = next; };
		} else if (def.dataType.kind === 'struct' && isLiteralParameterBinding(value)) {
			const fields = value.value as Record<string, Binding>;
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

// 未設定の値には共通の既定値を使うため、走査結果にはその子要素の入力方式も含める。
export function* walkParameters<Binding extends ParameterBindingBase>(defs: Record<string, ParameterDefinition>, params: Record<string, Binding>): Generator<{
	path: ParamPath; def: ParameterDefinition; value: Binding | ValueParameterBinding;
}> {
	function* walk(def: ParameterDefinition, value: Binding | ValueParameterBinding, path: ParamPath): ReturnType<typeof walkParameters<Binding>> {
		if (def.dataType.kind === 'array' && isLiteralParameterBinding(value)) {
			for (const element of value.value as ParameterArrayElement<Binding | ValueParameterBinding>[]) {
				yield* walk(getArrayElementDefinition(def), element.binding, [...path, element.id]);
			}
		} else if (def.dataType.kind === 'struct' && isLiteralParameterBinding(value)) {
			const fields = value.value as Record<string, Binding | ValueParameterBinding>;
			for (const [key, field] of Object.entries(getStructFieldDefinitions(def))) {
				yield* walk(field, fields[key], [...path, key]);
			}
		} else {
			yield { path, def, value };
		}
	}

	for (const [key, def] of Object.entries(defs)) yield* walk(def, params[key] ?? def.defaultValue, [key]);
}
