import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import type { EffectOptionsSchema } from '@glitch/shared/effect-definition.ts';
import type { EffectParamValue, GsEffectNode } from '@glitch/shared/types.ts';

export type ParamPath = readonly [string, ...(string | number)[]];
export type NodeParamValue = EffectParamValue | NodeParamValue[];
export type NodeParamDef = EffectOptionsSchema[string] & {
	default: () => NodeParamValue;
	visibility?: (params: Record<string, NodeParamValue>) => boolean;
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
	const params = node.params as Record<string, NodeParamValue>;
	let value = params[path[0]];
	let setValue = (next: NodeParamValue) => { params[path[0]] = next; };
	if (def == null || value == null) throw new Error(`Unknown parameter: ${paramPathKey(path)}`);

	for (const segment of path.slice(1)) {
		if (def.type === 'array') {
			if (!Array.isArray(value) || typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0 || segment >= value.length) {
				throw new Error(`Invalid array parameter path: ${paramPathKey(path)}`);
			}
			const array = value;
			def = def.item;
			value = array[segment];
			setValue = next => {
				array[segment] = next;
			};
		} else if (def.type === 'struct' && !Array.isArray(value) && value.type === 'literal' && typeof segment === 'string') {
			const fields = value.value as Record<string, NodeParamValue>;
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
	function* walk(def: NodeParamDef, value: NodeParamValue, path: ParamPath): ReturnType<typeof walkNodeParams> {
		if (def.type === 'array' && Array.isArray(value)) {
			for (const [index, element] of value.entries()) yield* walk(def.item, element, [...path, index]);
		} else if (!Array.isArray(value)) {
			if (def.type === 'struct' && value.type === 'literal') {
				for (const [key, field] of Object.entries(def.fields)) yield* walk(field, value.value[key], [...path, key]);
			} else {
				yield { path, def, value };
			}
		}
	}
	for (const [key, def] of Object.entries(getNodeParamDefs(node))) yield* walk(def, node.params[key], [key]);
}
