import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { isLiteralParameterBinding, type ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';

/** 保存・選択にはIDパスを使い、表示だけを現在の配列順とフィールド名に変換する。 */
export function getParameterPathLabel(defs: Record<string, ParameterDefinition>, params: Readonly<Record<string, ParameterBindingBase>>, path: ParamPath): string {
	const values = { [path[0]]: params[path[0]] ?? defs[path[0]]?.defaultValue };
	let currentPath: ParamPath = [path[0]];
	let parent = resolveParameter<ParameterBindingBase>(defs, values, currentPath);
	let label = parent.def.ui.label;
	for (const segment of path.slice(1)) {
		currentPath = [...currentPath, segment];
		const current = resolveParameter<ParameterBindingBase>(defs, values, currentPath);
		if (parent.def.dataType.kind === 'array' && isLiteralParameterBinding(parent.value)) {
			const index = (parent.value.value as ParameterArrayElement<ParameterBindingBase>[]).findIndex(element => element.id === segment);
			label += ` [${index}]`;
		} else {
			label += ` / ${current.def.ui.label}`;
		}
		parent = current;
	}
	return label;
}
