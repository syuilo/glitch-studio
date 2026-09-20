import type { EffectParamDef, EffectParamDefs, EffectParamValue } from '@glitch/shared/types.ts';

type ParamPath = (string | number)[];

// コンテナ自身の式は評価しない。literalの子だけを定義に沿ってたどる。
export function mapNodeParam(def: EffectParamDef, param: EffectParamValue, path: ParamPath,
	mapLeaf: (def: EffectParamDef, param: EffectParamValue, path: ParamPath) => any): any {
	if (def.type === 'array' || def.type === 'struct') {
		if (param.inputSource !== 'literal') throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
		if (def.type === 'array') {
			if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
			return param.value.map((value: EffectParamValue, index: number) => mapNodeParam(def.item, value, [...path, index], mapLeaf));
		}
		return Object.fromEntries(Object.entries(def.fields as EffectParamDefs).map(([key, field]) =>
			[key, mapNodeParam(field, param.value[key], [...path, key], mapLeaf)]));
	}
	return mapLeaf(def, param, path);
}

export function* walkNodeParams(defs: EffectParamDefs, params: Record<string, EffectParamValue>, bypass = false): Generator<{
	def: EffectParamDef; param: EffectParamValue; path: ParamPath;
}> {
	function* walk(def: EffectParamDef, param: EffectParamValue, path: ParamPath): ReturnType<typeof walkNodeParams> {
		if (def.type === 'array' || def.type === 'struct') {
			if (param.inputSource !== 'literal') throw new Error(`Container parameter must be literal: ${JSON.stringify(path)}`);
			if (def.type === 'array') {
				if (!Array.isArray(param.value)) throw new Error(`Expected array parameter: ${JSON.stringify(path)}`);
				for (const [index, value] of param.value.entries()) yield* walk(def.item, value, [...path, index]);
			} else {
				for (const [key, field] of Object.entries(def.fields as EffectParamDefs)) yield* walk(field, param.value[key], [...path, key]);
			}
		} else {
			yield { def, param, path };
		}
	}

	for (const [key, def] of Object.entries(defs)) {
		if (bypass && !def.primary) continue;
		yield* walk(def, params[key], [key]);
	}
}

export function getEvaluatedParam(params: Record<string, any>, path: ParamPath): any {
	return path.reduce((value, key) => value[key], params);
}
