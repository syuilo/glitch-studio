import * as blendModes from 'color-blend';
import * as math from 'mathjs';
import { Layer } from '.';
import { blend } from './color';

export type Color = [number, number, number, number];

export type FX = (
	width: number, height: number,
	get: (x: number, y: number) => Color,
	set: (x: number, y: number, color: Color) => void,
	params: Record<string, any>,
) => void;

type DataType = 'number' | 'range' | 'enum' | 'bool' | 'blendMode' | 'signal' | 'xy';

export type ParamDef = {
	type: DataType;
	label: string;
	default: {
		type: 'literal' | 'expression';
		value: any;
	};
};

export type ParamDefs = Record<string, ParamDef>;

export type Macro = {
	id: string;
	label: string;
	name: string;
	type: DataType;
	value: {
		type: 'literal' | 'expression';
		value: any;
	};
};

export const basicParamDefs = {
	_width: {
		label: 'Width',
		type: 'range' as const,
		default: { type: 'expression' as const, value: 'WIDTH' }
	},
	_height: {
		label: 'Height',
		type: 'range' as const,
		default: { type: 'expression' as const, value: 'HEIGHT' }
	},
	_pos: {
		label: 'XY',
		type: 'xy' as const,
		default: { type: 'literal' as const, value: [0, 0] }
	},
	_alpha: {
		label: 'Alpha',
		type: 'range' as const,
		min: 0,
		max: 255,
		default: { type: 'literal' as const, value: 255 }
	},
	_blendMode: {
		label: 'Blend mode',
		type: 'blendMode' as const,
		default: { type: 'literal' as const, value: 'normal' }
	},
};

export function fx(paramDefs: ParamDefs, fx: FX) {
	return (input: any, params: Layer['params'], macros: Macro[]) => {
		const output = input.clone();

		const defaults = {} as Layer['params'];

		for (const [k, v] of Object.entries(paramDefs)) {
			defaults[k] = v.default;
		}

		const evaluate = (expression: string, scope: Record<string, any>) => {
			const value = math.evaluate(expression, scope);
			if (value.constructor.name === 'Matrix') {
				return value.toArray();
			} else {
				return value;
			}
		};

		const mergedParams = { ...defaults, ...params } as Layer['params'];

		const evaluatedParams = {} as Record<string, any>;

		const scope = {
			WIDTH: input.bitmap.width,
			HEIGHT: input.bitmap.height,
		};

		// Mixin macros
		const macroScope = {} as Record<string, any>;
		for (const macro of macros) {
			macroScope[macro.name] =
				macro.value.type === 'literal'
					? macro.value.value
					: macro.value.value
						? evaluate(macro.value.value, scope)
						: genEmptyValue(macro);
		}

		const mixedScope = {
			...macroScope,
			...scope,
		};

		for (const [k, v] of Object.entries(mergedParams)) {
			evaluatedParams[k] =
				v.type === 'literal'
					? v.value
					: v.value
						? evaluate(v.value, mixedScope)
						: genEmptyValue(paramDefs[k]);
		}

		console.debug('EVAL', evaluatedParams);

		let get = (x: number, y: number) => {
			const idx = (input.bitmap.width * y + x) << 2;
			return [
				input.bitmap.data[idx + 0],
				input.bitmap.data[idx + 1],
				input.bitmap.data[idx + 2],
				input.bitmap.data[idx + 3],
			] as Color;
		};

		let set = evaluatedParams['_blendMode'] === 'none'
			? (x: number, y: number, rgba: Color) => {
				const idx = (input.bitmap.width * y + x) << 2;
				rgba = blend([
					input.bitmap.data[idx + 0],
					input.bitmap.data[idx + 1],
					input.bitmap.data[idx + 2],
					input.bitmap.data[idx + 3]
				], rgba, evaluatedParams['_alpha'] / 255);
				output.bitmap.data[idx + 0] = rgba[0];
				output.bitmap.data[idx + 1] = rgba[1];
				output.bitmap.data[idx + 2] = rgba[2];
				output.bitmap.data[idx + 3] = rgba[3];
			}
			: (x: number, y: number, rgba: Color) => {
				const idx = (input.bitmap.width * y + x) << 2;
				const { r, g, b, a } = (blendModes as any)[evaluatedParams['_blendMode']]({
					r: input.bitmap.data[idx + 0],
					g: input.bitmap.data[idx + 1],
					b: input.bitmap.data[idx + 2],
					a: input.bitmap.data[idx + 3],
				}, {
					r: rgba[0],
					g: rgba[1],
					b: rgba[2],
					a: Math.min(evaluatedParams['_alpha'], rgba[3]) / Math.max(evaluatedParams['_alpha'], rgba[3]),
				});
				output.bitmap.data[idx + 0] = r;
				output.bitmap.data[idx + 1] = g;
				output.bitmap.data[idx + 2] = b;
				output.bitmap.data[idx + 3] = Math.floor(a * 255);
			};

		if (evaluatedParams['_pos'][0] !== 0 || evaluatedParams['_pos'][1] !== 0) {
			get = (x: number, y: number) => {
				x = x + evaluatedParams['_pos'][0];
				y = y + evaluatedParams['_pos'][1];
				const idx = (input.bitmap.width * y + x) << 2;
				return [
					input.bitmap.data[idx + 0],
					input.bitmap.data[idx + 1],
					input.bitmap.data[idx + 2],
					input.bitmap.data[idx + 3],
				] as Color;
			};

			set = evaluatedParams['_blendMode'] === 'none'
				? (x: number, y: number, rgba: Color) => {
					x = x + evaluatedParams['_pos'][0];
					y = y + evaluatedParams['_pos'][1];
					const idx = (input.bitmap.width * y + x) << 2;
					rgba = blend([
						input.bitmap.data[idx + 0],
						input.bitmap.data[idx + 1],
						input.bitmap.data[idx + 2],
						input.bitmap.data[idx + 3]
					], rgba, evaluatedParams['_alpha'] / 255);
					output.bitmap.data[idx + 0] = rgba[0];
					output.bitmap.data[idx + 1] = rgba[1];
					output.bitmap.data[idx + 2] = rgba[2];
					output.bitmap.data[idx + 3] = rgba[3];
				}
				: (x: number, y: number, rgba: Color) => {
					x = x + evaluatedParams['_pos'][0];
					y = y + evaluatedParams['_pos'][1];	
					const idx = (input.bitmap.width * y + x) << 2;
					const { r, g, b, a } = (blendModes as any)[evaluatedParams['_blendMode']]({
						r: input.bitmap.data[idx + 0],
						g: input.bitmap.data[idx + 1],
						b: input.bitmap.data[idx + 2],
						a: 1
					}, {
						r: rgba[0],
						g: rgba[1],
						b: rgba[2],
						a: Math.min(evaluatedParams['_alpha'], rgba[3]) / Math.max(evaluatedParams['_alpha'], rgba[3]),
					});
					output.bitmap.data[idx + 0] = r;
					output.bitmap.data[idx + 1] = g;
					output.bitmap.data[idx + 2] = b;
					output.bitmap.data[idx + 3] = Math.floor(a * 255);
				};
		}

		let width = evaluatedParams['_width'];
		let height = evaluatedParams['_height'];

		if (evaluatedParams['_pos'][0] + width > input.bitmap.width) {
			width = Math.max(
				input.bitmap.width - evaluatedParams['_pos'][0],
				input.bitmap.width - ((evaluatedParams['_pos'][0] + width) - input.bitmap.width));
		}

		if (evaluatedParams['_pos'][1] + height > input.bitmap.height) {
			height = Math.max(
				input.bitmap.height - evaluatedParams['_pos'][1],
				input.bitmap.height - ((evaluatedParams['_pos'][1] + height) - input.bitmap.height));
		}

		fx(width, height, get, set, evaluatedParams);

		return output;
	}
}

export function genEmptyValue(paramDef: Omit<ParamDef, 'default'>): any {
	if (paramDef.type === 'number') {
		return 0;
	} else if (paramDef.type === 'range') {
		let v = 0;
		if (paramDef.hasOwnProperty('min')) v = Math.max((paramDef as any)['min'], v);
		if (paramDef.hasOwnProperty('max')) v = Math.min((paramDef as any)['max'], v);
		return v;
	} else if (paramDef.type === 'enum') {
		return (paramDef as any)['options'][0].value;
	} else if (paramDef.type === 'bool') {
		return false;
	} else if (paramDef.type === 'blendMode') {
		return 'normal';
	} else if (paramDef.type === 'signal') {
		return [false, false, false];
	} else if (paramDef.type === 'xy') {
		return [0, 0];
	}
}
