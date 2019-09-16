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
	default: {
		type: 'literal' | 'expression';
		value: any;
	};
};

export type ParamDefs = Record<string, ParamDef>;

export type Macro = {
	label: string;
	name: string;
	type: DataType;
};

export function fx(paramDefs: ParamDefs, fx: FX) {
	return (input: any, params = {}) => {
		const output = input.clone();

		function get(x: number, y: number) {
			const idx = (input.bitmap.width * y + x) << 2;
			return [input.bitmap.data[idx + 0], input.bitmap.data[idx + 1], input.bitmap.data[idx + 2]] as Pixel;
		}

		function set(x: number, y: number, rgb: Pixel) {
			const idx = (input.bitmap.width * y + x) << 2;
			output.bitmap.data[idx + 0] = rgb[0];
			output.bitmap.data[idx + 1] = rgb[1];
			output.bitmap.data[idx + 2] = rgb[2];
		}

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

		for (const [k, v] of Object.entries(mergedParams)) {
			evaluatedParams[k] =
				v.type === 'literal'
					? v.value
					: v.value
						? math.evaluate(v.value, scope)
						: genEmptyValue(paramDefs[k]);
		}

		console.debug('EVAL', evaluatedParams);

		fx(input.bitmap.width, input.bitmap.height, get, set, evaluatedParams);

		return output;
	}
}

export function genEmptyValue(paramDef: ParamDef): any {
	if (paramDef.type === 'number') {
		return 0;
	} else if (paramDef.type === 'range') {
		let v = 0;
		if (paramDef.hasOwnProperty('min')) v = Math.max((paramDef as any)['min'], v);
		if (paramDef.hasOwnProperty('max')) v = Math.min((paramDef as any)['max'], v);
		return v;
	} else if (paramDef.type === 'enum') {
		return (paramDef as any)['options'][0];
	} else if (paramDef.type === 'bool') {
		return false;
	} else if (paramDef.type === 'blendMode') {
		return 'normal';
	} else if (paramDef.type === 'signal') {
		return [false, false, false];
	}
}
