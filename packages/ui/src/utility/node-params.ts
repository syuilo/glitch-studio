import { effectDefinitions } from '@glitch/shared/effect/effect-definitions.ts';
import type { ParameterDefinition } from '@glitch/shared/parameter.ts';
import type { ParameterBinding } from '@glitch/shared/types.ts';
import type { VisualModuleEffectNode } from '@glitch/shared/visual-module/types.ts';

export type ParamPath = readonly [string, ...(string | number)[]];
export type NodeParamDef = ParameterDefinition & {
	defaultValue: ParameterBinding;
};

export type NodeParamTarget = {
	nodeId: VisualModuleEffectNode['id'];
	paramPath: ParamPath;
};

export function getNodeParamDefs(node: VisualModuleEffectNode): Record<string, NodeParamDef> {
	return effectDefinitions[node.effectId].paramDefs as Record<string, NodeParamDef>;
}

export function paramPathKey(path: ParamPath): string {
	// フィールド名に区切り文字が含まれても、配列インデックスと衝突しない。
	return JSON.stringify(path);
}

export function resolveNodeParam(node: VisualModuleEffectNode, path: ParamPath) {
	let def = getNodeParamDefs(node)[path[0]];
	const params = node.params;
	let value = params[path[0]];
	let setValue = (next: ParameterBinding) => { params[path[0]] = next; };
	if (def == null || value == null) throw new Error(`Unknown parameter: ${paramPathKey(path)}`);

	for (const segment of path.slice(1)) {
		if (def.dataType === 'array') {
			if (value.inputSource !== 'literal' || !Array.isArray(value.value) || typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0 || segment >= value.value.length) {
				throw new Error(`Invalid array parameter path: ${paramPathKey(path)}`);
			}
			const array = value.value as ParameterBinding[];
			def = def.item;
			value = array[segment];
			setValue = next => {
				array[segment] = next;
			};
		} else if (def.dataType === 'struct' && value.inputSource === 'literal' && typeof segment === 'string') {
			const fields = value.value as Record<string, ParameterBinding>;
			def = def.fields[segment];
			value = fields[segment];
			setValue = next => { fields[segment] = next; };
			if (def == null || value == null) throw new Error(`Unknown struct field: ${paramPathKey(path)}`);
		} else {
			throw new Error(`Invalid parameter path: ${paramPathKey(path)}`);
		}
	}
	return { def, value, setValue };
}

// ワイヤー表示と参照の更新でも、定義に沿って子をたどる（color等のliteral配列とは区別する）。
export function* walkNodeParams(node: VisualModuleEffectNode): Generator<{ path: ParamPath; def: NodeParamDef; value: ParameterBinding }> {
	function* walk(def: NodeParamDef, value: ParameterBinding, path: ParamPath): ReturnType<typeof walkNodeParams> {
		if (def.dataType === 'array' && value.inputSource === 'literal') {
			const elements = value.value as ParameterBinding[];
			for (const [index, element] of elements.entries()) yield* walk(def.item, element, [...path, index]);
		} else if (def.dataType === 'struct' && value.inputSource === 'literal') {
			for (const [key, field] of Object.entries(def.fields)) yield* walk(field, value.value[key], [...path, key]);
		} else {
			yield { path, def, value };
		}
	}

	for (const [key, def] of Object.entries(getNodeParamDefs(node))) yield* walk(def, node.params[key], [key]);
}
