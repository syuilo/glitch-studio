import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import type { EffectOptionsSchema } from '@glitch/shared/effect-definition.ts';
import type { EffectParamValue, GsEffectNode } from '@glitch/shared/types.ts';

export type ParamPath = readonly [string, ...(string | number)[]];
export type NodeParamDef = EffectOptionsSchema[string] & {
	default: () => EffectParamValue;
	visibility?: (params: Record<string, EffectParamValue>) => boolean;
};

export type NodeParamTarget = {
	nodeId: GsEffectNode['id'];
	paramPath: ParamPath;
};

export function getNodeParamDefs(node: GsEffectNode): Record<string, NodeParamDef> {
	return effectDefinitions[node.effectId].paramDefs as Record<string, NodeParamDef>;
}

export function paramPathKey(path: ParamPath): string {
	// フィールド名に区切り文字が含まれても、配列インデックスと衝突しない。
	return JSON.stringify(path);
}

export function resolveNodeParam(node: GsEffectNode, path: ParamPath) {
	let def = getNodeParamDefs(node)[path[0]];
	const params = node.params;
	let value = params[path[0]];
	let setValue = (next: EffectParamValue) => { params[path[0]] = next; };
	if (def == null || value == null) throw new Error(`Unknown parameter: ${paramPathKey(path)}`);

	for (const segment of path.slice(1)) {
		if (def.dataType === 'array') {
			if (value.inputSource !== 'literal' || !Array.isArray(value.value) || typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0 || segment >= value.value.length) {
				throw new Error(`Invalid array parameter path: ${paramPathKey(path)}`);
			}
			const array = value.value as EffectParamValue[];
			def = def.item;
			value = array[segment];
			setValue = next => {
				array[segment] = next;
			};
		} else if (def.dataType === 'struct' && value.inputSource === 'literal' && typeof segment === 'string') {
			const fields = value.value as Record<string, EffectParamValue>;
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
export function* walkNodeParams(node: GsEffectNode): Generator<{ path: ParamPath; def: NodeParamDef; value: EffectParamValue }> {
	function* walk(def: NodeParamDef, value: EffectParamValue, path: ParamPath): ReturnType<typeof walkNodeParams> {
		if (def.dataType === 'array' && value.inputSource === 'literal') {
			const elements = value.value as EffectParamValue[];
			for (const [index, element] of elements.entries()) yield* walk(def.item, element, [...path, index]);
		} else if (def.dataType === 'struct' && value.inputSource === 'literal') {
			for (const [key, field] of Object.entries(def.fields)) yield* walk(field, value.value[key], [...path, key]);
		} else {
			yield { path, def, value };
		}
	}

	for (const [key, def] of Object.entries(getNodeParamDefs(node))) yield* walk(def, node.params[key], [key]);
}
