import { getShapeParameterDefinitions } from './shape.ts';
import { validateTimelineParameterTree } from './parameter-binding.ts';
import type { Shape } from './shape.ts';

/** 保存・Command・レンダラーの受け入れ境界で、シェイプに許可するBindingを検証する。 */
export function validateTimelineShape(shape: Shape): void {
	const defs = getShapeParameterDefinitions(shape.type);
	for (const [key, binding] of Object.entries(shape.paramValues)) {
		if (!Object.hasOwn(defs, key)) throw new Error(`Unknown shape parameter: ${key}`);
		validateTimelineParameterTree(defs[key], binding);
	}
}
