import * as blend from 'color-blend';
import * as math from 'mathjs';
import { Layer } from '.';

export type Pixel = [number, number, number];

export type FX = (
	width: number, height: number,
	get: (x: number, y: number) => Pixel,
	set: (x: number, y: number, color: Pixel) => void,
	params: Record<string, any>,
) => void;

type DataType = 'number' | 'range' | 'enum' | 'bool' | 'blendMode' | 'signal';

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
	_x: {
		label: 'X',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 0 }
	},
	_y: {
		label: 'Y',
		type: 'range' as const,
		default: { type: 'literal' as const, value: 0 }
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
						? math.evaluate(macro.value.value, scope)
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
						? math.evaluate(v.value, mixedScope)
						: genEmptyValue(paramDefs[k]);
		}

		console.debug('EVAL', evaluatedParams);

		let get = (x: number, y: number) => {
			const idx = (input.bitmap.width * y + x) << 2;
			return [input.bitmap.data[idx + 0], input.bitmap.data[idx + 1], input.bitmap.data[idx + 2]] as Pixel;
		};

		let set = evaluatedParams['_alpha'] === 255 && evaluatedParams['_blendMode'] === 'noraml'
			? (x: number, y: number, rgb: Pixel) => {
				const idx = (input.bitmap.width * y + x) << 2;
				output.bitmap.data[idx + 0] = rgb[0];
				output.bitmap.data[idx + 1] = rgb[1];
				output.bitmap.data[idx + 2] = rgb[2];
			}
			: (x: number, y: number, rgb: Pixel) => {
				const idx = (input.bitmap.width * y + x) << 2;
				const { r, g, b } = (blend as any)[evaluatedParams['_blendMode']]({
					r: input.bitmap.data[idx + 0],
					g: input.bitmap.data[idx + 1],
					b: input.bitmap.data[idx + 2],
					a: 255
				}, {
					r: rgb[0],
					g: rgb[1],
					b: rgb[2],
					a: evaluatedParams['_alpha'] / 255
				});
				output.bitmap.data[idx + 0] = r;
				output.bitmap.data[idx + 1] = g;
				output.bitmap.data[idx + 2] = b;
			};

		if (evaluatedParams['_x'] !== 0 || evaluatedParams['_y'] !== 0) {
			get = (x: number, y: number) => {
				x = x + evaluatedParams['_x'];
				y = y + evaluatedParams['_y'];
				const idx = (input.bitmap.width * y + x) << 2;
				return [input.bitmap.data[idx + 0], input.bitmap.data[idx + 1], input.bitmap.data[idx + 2]] as Pixel;
			};

			set = evaluatedParams['_alpha'] === 255 && evaluatedParams['_blendMode'] === 'noraml'
				? (x: number, y: number, rgb: Pixel) => {
					x = x + evaluatedParams['_x'];
					y = y + evaluatedParams['_y'];
					const idx = (input.bitmap.width * y + x) << 2;
					output.bitmap.data[idx + 0] = rgb[0];
					output.bitmap.data[idx + 1] = rgb[1];
					output.bitmap.data[idx + 2] = rgb[2];
				}
				: (x: number, y: number, rgb: Pixel) => {
					x = x + evaluatedParams['_x'];
					y = y + evaluatedParams['_y'];
					const idx = (input.bitmap.width * y + x) << 2;
					const { r, g, b } = (blend as any)[evaluatedParams['_blendMode']]({
						r: input.bitmap.data[idx + 0],
						g: input.bitmap.data[idx + 1],
						b: input.bitmap.data[idx + 2],
						a: 255
					}, {
						r: rgb[0],
						g: rgb[1],
						b: rgb[2],
						a: evaluatedParams['_alpha'] / 255
					});
					output.bitmap.data[idx + 0] = r;
					output.bitmap.data[idx + 1] = g;
					output.bitmap.data[idx + 2] = b;
				};
		}

		let width = evaluatedParams['_width'];
		let height = evaluatedParams['_height'];

		if (evaluatedParams['_x'] + width > input.bitmap.width) {
			width = Math.max(
				input.bitmap.width - evaluatedParams['_x'],
				input.bitmap.width - ((evaluatedParams['_x'] + width) - input.bitmap.width));
		}

		if (evaluatedParams['_y'] + height > input.bitmap.height) {
			height = Math.max(
				input.bitmap.height - evaluatedParams['_y'],
				input.bitmap.height - ((evaluatedParams['_y'] + height) - input.bitmap.height));
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
	}
}
