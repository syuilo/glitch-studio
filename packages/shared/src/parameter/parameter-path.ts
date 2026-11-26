import { getArrayElementDefinition, getStructFieldDefinitions, getVectorComponentDefinition, isParameterType } from './parameter-definition.ts';
import { isLiteralParameterBinding, isValueParameterBinding } from './parameter-binding.ts';
import type { ParameterArrayElement, ParameterBindingBase } from './parameter-binding.ts';
import type { ParameterDefinition } from './parameter-definition.ts';
import type { ScalarParameterBinding } from './value-parameter-binding.ts';

// 配列は要素ID、分割したベクトルは固定の添字文字列「0」「1」で指定する。
export type ParamPath = readonly [string, ...string[]];

export function paramPathKey(path: ParamPath): string {
	return JSON.stringify(path);
}

// 親の具体型を子や書き込み先の型に流用せず、利用ドメインのBinding全体を明示させる。
// literalの親だけを渡した場合も、末端では式・接続への切替ができる必要がある。
export function resolveParameter<Binding extends ParameterBindingBase = never>(defs: Record<string, ParameterDefinition>, params: NoInfer<Record<string, Binding>>, path: ParamPath) {
	let def = defs[path[0]];
	let value = params[path[0]];
	let setValue = (next: NoInfer<Binding>) => { params[path[0]] = next; };
	let hasArrayElementInPath = false;
	let isVectorComponent = false;
	if (def == null || value == null) throw new Error(`Unknown parameter: ${paramPathKey(path)}`);
	for (const segment of path.slice(1)) {
		if (isParameterType(def, 'array') && isLiteralParameterBinding(value) && Array.isArray(value.value)) {
			const element = (value.value as ParameterArrayElement<Binding>[]).find(element => element.id === segment);
			// 削除済みのIDを、同じindexにある別要素へ読み替えてはいけない。
			if (element == null) throw new Error(`Unknown array element: ${paramPathKey(path)}`);
			hasArrayElementInPath = true;
			def = getArrayElementDefinition(def);
			value = element.binding;
			setValue = next => { element.binding = next; };
		} else if (isParameterType(def, 'struct') && isLiteralParameterBinding(value)) {
			const fields = value.value as Record<string, Binding>;
			def = getStructFieldDefinitions(def)[segment];
			value = fields[segment];
			setValue = next => { fields[segment] = next; };
			if (def == null || value == null) throw new Error(`Unknown struct field: ${paramPathKey(path)}`);
		} else if (isParameterType(def, 'vector') && isValueParameterBinding(value) && value.inputSource === 'components' && (segment === '0' || segment === '1')) {
			const index = segment === '0' ? 0 : 1;
			const components = value.components;
			isVectorComponent = true;
			def = getVectorComponentDefinition(def, index, def.defaultValue[index]);
			value = components[index] as unknown as Binding;
			setValue = next => { components[index] = next as unknown as ScalarParameterBinding; };
		} else {
			throw new Error(`Invalid parameter path: ${paramPathKey(path)}`);
		}
	}
	return { def, value, setValue, hasArrayElementInPath, isVectorComponent };
}

// 呼び出し側が渡したBindingを定義順でたどる。
export function* walkParameters<Binding extends ParameterBindingBase = never>(defs: Record<string, ParameterDefinition>, params: NoInfer<Record<string, Binding>>): Generator<{
	path: ParamPath; def: ParameterDefinition; value: Binding;
}> {
	function* walk(def: ParameterDefinition, value: Binding, path: ParamPath): ReturnType<typeof walkParameters<Binding>> {
		if (isParameterType(def, 'array') && isLiteralParameterBinding(value)) {
			for (const element of value.value as ParameterArrayElement<Binding>[]) {
				yield* walk(getArrayElementDefinition(def), element.binding, [...path, element.id]);
			}
		} else if (isParameterType(def, 'struct') && isLiteralParameterBinding(value)) {
			const fields = value.value as Record<string, Binding>;
			for (const [key, field] of Object.entries(getStructFieldDefinitions(def))) {
				yield* walk(field, fields[key], [...path, key]);
			}
		} else {
			yield { path, def, value };
			// 親の加工式と成分のキー・式をそれぞれ処理できるよう、双方を走査する。
			if (isParameterType(def, 'vector') && isValueParameterBinding(value) && value.inputSource === 'components') {
				for (const index of [0, 1] as const) {
					yield { path: [...path, String(index)], def: getVectorComponentDefinition(def, index, def.defaultValue[index]), value: value.components[index] as unknown as Binding };
				}
			}
		}
	}

	for (const [key, def] of Object.entries(defs)) {
		const value = params[key];
		if (value != null) yield* walk(def, value, [key]);
	}
}
