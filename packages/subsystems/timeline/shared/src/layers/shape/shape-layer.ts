import { getShapeParameterDefinitions } from './shape.ts';
import { inspectTimelineParameters } from '../../parameter-validation.ts';
import type { Shape } from './shape.ts';

/** 保存・Command・レンダラーの受け入れ境界で、シェイプに許可するBindingを検証する。 */
export function validateTimelineShape(shape: Shape): void {
	const diagnostics = inspectTimelineParameters(getShapeParameterDefinitions(shape.type), shape.paramValues, false, false, 'shape parameter');
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}
