import * as blendModes from 'color-blend';
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

export function fx(fx: FX) {
	return (input: { width: number; height: number; data: Uint8Array; }, evaluatedParams: Record<string, any>) => {
		const output = input.data.slice(0);

		let get = (x: number, y: number) => {
			const idx = (input.width * y + x) << 2;
			return [
				input.data[idx + 0],
				input.data[idx + 1],
				input.data[idx + 2],
				input.data[idx + 3],
			] as Color;
		};

		let set = evaluatedParams['_blendMode'] === 'none'
			? (x: number, y: number, rgba: Color) => {
				const idx = (input.width * y + x) << 2;
				rgba = blend([
					input.data[idx + 0],
					input.data[idx + 1],
					input.data[idx + 2],
					input.data[idx + 3]
				], rgba, evaluatedParams['_alpha'] / 255);
				output[idx + 0] = rgba[0];
				output[idx + 1] = rgba[1];
				output[idx + 2] = rgba[2];
				output[idx + 3] = rgba[3];
			}
			: (x: number, y: number, rgba: Color) => {
				const idx = (input.width * y + x) << 2;
				const { r, g, b, a } = (blendModes as any)[evaluatedParams['_blendMode']]({
					r: input.data[idx + 0],
					g: input.data[idx + 1],
					b: input.data[idx + 2],
					a: input.data[idx + 3],
				}, {
					r: rgba[0],
					g: rgba[1],
					b: rgba[2],
					a: Math.min(evaluatedParams['_alpha'], rgba[3]) / Math.max(evaluatedParams['_alpha'], rgba[3]),
				});
				output[idx + 0] = r;
				output[idx + 1] = g;
				output[idx + 2] = b;
				output[idx + 3] = Math.floor(a * 255);
			};

		if (evaluatedParams['_pos'][0] !== 0 || evaluatedParams['_pos'][1] !== 0) {
			get = (x: number, y: number) => {
				x = x + evaluatedParams['_pos'][0];
				y = y + evaluatedParams['_pos'][1];
				const idx = (input.width * y + x) << 2;
				return [
					input.data[idx + 0],
					input.data[idx + 1],
					input.data[idx + 2],
					input.data[idx + 3],
				] as Color;
			};

			set = evaluatedParams['_blendMode'] === 'none'
				? (x: number, y: number, rgba: Color) => {
					x = x + evaluatedParams['_pos'][0];
					y = y + evaluatedParams['_pos'][1];
					const idx = (input.width * y + x) << 2;
					rgba = blend([
						input.data[idx + 0],
						input.data[idx + 1],
						input.data[idx + 2],
						input.data[idx + 3]
					], rgba, evaluatedParams['_alpha'] / 255);
					output[idx + 0] = rgba[0];
					output[idx + 1] = rgba[1];
					output[idx + 2] = rgba[2];
					output[idx + 3] = rgba[3];
				}
				: (x: number, y: number, rgba: Color) => {
					x = x + evaluatedParams['_pos'][0];
					y = y + evaluatedParams['_pos'][1];
					const idx = (input.width * y + x) << 2;
					const { r, g, b, a } = (blendModes as any)[evaluatedParams['_blendMode']]({
						r: input.data[idx + 0],
						g: input.data[idx + 1],
						b: input.data[idx + 2],
						a: 1
					}, {
						r: rgba[0],
						g: rgba[1],
						b: rgba[2],
						a: Math.min(evaluatedParams['_alpha'], rgba[3]) / Math.max(evaluatedParams['_alpha'], rgba[3]),
					});
					output[idx + 0] = r;
					output[idx + 1] = g;
					output[idx + 2] = b;
					output[idx + 3] = Math.floor(a * 255);
				};
		}

		let width = evaluatedParams['_width'];
		let height = evaluatedParams['_height'];

		if (evaluatedParams['_pos'][0] + width > input.width) {
			width = input.width - evaluatedParams['_pos'][0];
		}

		if (evaluatedParams['_pos'][1] + height > input.height) {
			height = input.height - evaluatedParams['_pos'][1];
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
