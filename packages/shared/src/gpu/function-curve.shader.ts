import { EASING_DIRECTIONS, EASING_FAMILIES } from '../easing.ts';
import { FUNCTION_CURVE_KINDS } from './function-curve-kinds.ts';
import functionCurveCode from './function-curve.wgsl?raw';

export default [
	...Object.entries(FUNCTION_CURVE_KINDS).map(([kind, index]) => `const FUNCTION_CURVE_${kind.toUpperCase()} = ${index}u;`),
	...EASING_FAMILIES.map((family, index) => `const FUNCTION_CURVE_EASING_${family.toUpperCase()} = ${index}u;`),
	...EASING_DIRECTIONS.map((direction, index) => `const FUNCTION_CURVE_DIRECTION_${direction.toUpperCase()} = ${index}u;`),
	functionCurveCode,
].join('\n');
