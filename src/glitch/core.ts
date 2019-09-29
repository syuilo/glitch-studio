import * as blendModes from 'color-blend';
import { blend, getBrightness } from './color';

export type Color = [number, number, number, number];

export type FX = (
	width: number, height: number,
	get: (x: number, y: number) => Color,
	set: (x: number, y: number, color: Color) => void,
	params: Record<string, any>,
) => void;

type DataType = 'number' | 'range' | 'enum' | 'bool' | 'blendMode' | 'signal' | 'xy' | 'wh' | 'color' | 'seed' | 'image';

export type Value = {
	type: 'literal' | 'expression';
	value: any;
};

export type ParamDef = {
	type: DataType;
	label: string;
	default: Value;
	visibility?: (state: Record<string, Value>) => boolean;
};

export type ParamDefs = Record<string, ParamDef>;

export type Macro = {
	id: string;
	label: string;
	name: string;
	type: DataType;
	typeOptions: Record<string, any>;
	value: Value;
};

export type Asset = {
	id: string;
	name: string;
	width: number;
	height: number;
	data: Uint8Array;
	buffer: Buffer;
	hash: string;
};

export const basicParamDefs = {
	_wh: {
		label: 'WH',
		type: 'wh' as const,
		default: { type: 'expression' as const, value: '[WIDTH, HEIGHT]' }
	},
	_pos: {
		label: 'XY',
		type: 'xy' as const,
		default: { type: 'literal' as const, value: [0, 0] }
	},
	_mask: {
		label: 'Mask',
		type: 'image' as const,
		default: { type: 'literal' as const, value: null }
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

		let width = evaluatedParams['_wh'][0];
		let height = evaluatedParams['_wh'][1];

		if (evaluatedParams['_pos'][0] + width > input.width) {
			width = input.width - evaluatedParams['_pos'][0];
		}

		if (evaluatedParams['_pos'][1] + height > input.height) {
			height = input.height - evaluatedParams['_pos'][1];
		}

		fx(width, height, get, set, evaluatedParams);

		const mask = evaluatedParams['_mask'];
		if (mask) { // Apply mask
			for (let x = 0; x < width; x++) {
				for (let y = 0; y < height; y++) {
					const idx = (width * y + x) << 2;
					const maskIdx = (mask.width * y + x) << 2;
					
					const mix = getBrightness([
						mask.data[maskIdx + 0],
						mask.data[maskIdx + 1],
						mask.data[maskIdx + 2],
						mask.data[maskIdx + 3],
					]);

					const color = blend([
						input.data[idx + 0],
						input.data[idx + 1],
						input.data[idx + 2],
						input.data[idx + 3],
					], [
						output[idx + 0],
						output[idx + 1],
						output[idx + 2],
						output[idx + 3],
					], mix / 255);

					output[idx + 0] = color[0];
					output[idx + 1] = color[1];
					output[idx + 2] = color[2];
					output[idx + 3] = color[3];
				}
			}
		}

		return output;
	}
}

export function makePxGetter(containerWidth: number, containerHeight: number, image: Asset) {
	const widthRatio = containerWidth / image.width;
	const heightRatio = containerHeight / image.height;
	const n = Math.max(widthRatio, heightRatio); // 拡大率
	const finalWidth = image.width * n;
	const finalHeight = image.height * n;
	const overX = finalWidth - containerWidth;
	const overY = finalHeight - containerHeight;
	return (x: number, y: number) => {
		const _x = Math.floor((x + Math.floor(overX / 2)) / n);
		const _y = Math.floor((y + Math.floor(overY / 2)) / n);
		const idx = (image.width * _y + _x) << 2;
		return [
			image.data[idx + 0],
			image.data[idx + 1],
			image.data[idx + 2],
			image.data[idx + 3],
		] as Color;
	};
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
	} else if (paramDef.type === 'wh') {
		return [1024, 1024];
	} else if (paramDef.type === 'color') {
		return [0, 0, 0];
	} else if (paramDef.type === 'seed') {
		return 0;
	} else if (paramDef.type === 'image') {
		return null;
	}
}
