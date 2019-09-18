import * as math from 'mathjs';
import { Macro, genEmptyValue } from './core';
import Renderer from 'worker-loader!./workers/renderer';
import HistogramWorker from 'worker-loader!./workers/histogram';
import { fxs } from './fxs';

export type Layer = {
	id: string;
	fx: string;
	isEnabled: boolean;
	params: Record<string, {
		type: 'literal' | 'expression';
		value: any;
	}>;
};

export type Histogram = {
	bins: {
		v1: number[]; v2: number[]; v3: number[];
	};
	max: number;
	rAmount: number;
	gAmount: number;
	bAmount: number;
	amountMax: number;
	amountMin: number;
};

const renderer = new Renderer();
const histogramWorker = new HistogramWorker();

const evaluate = (expression: string, scope: Record<string, any>) => {
	const value = math.evaluate(expression, scope);
	if (value.constructor.name === 'Matrix') {
		return value.toArray();
	} else {
		return value;
	}
};

/**
 * Apply FX and render it to a canvas
 */
export async function render(
	src: any, layers: Layer[], macros: Macro[],
	init: (w: number, h: number) => Promise<CanvasRenderingContext2D>,
	histogram: (histogram: Histogram) => void,
	progress: (max: number, done: number, status: string, args?: any) => void
) {
	return new Promise(async (res, rej) => {
		if (src == null) return res();

		let img = src.clone();
	
		const ctx = await init(img.bitmap.width, img.bitmap.height);
	
		const evaluatedParamses = [];
	
		for (const layer of layers) {
			const params = layer.params;
			const paramDefs = fxs[layer.fx].paramDefs;
		
			// Bake all params
			const defaults = {} as Layer['params'];
	
			for (const [k, v] of Object.entries(paramDefs)) {
				defaults[k] = v.default;
			}
	
			const mergedParams = { ...defaults, ...params } as Layer['params'];
	
			const evaluatedParams = {} as Record<string, any>;
	
			const scope = {
				WIDTH: img.bitmap.width,
				HEIGHT: img.bitmap.height,
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
	
			evaluatedParamses.push(evaluatedParams);
		}
	
		renderer.postMessage({
			img: {
				width: img.bitmap.width,
				height: img.bitmap.height,
				data: img.bitmap.data,
			},
			layers: layers,
			evaluatedParamses
		});
	
		const onMessage = (e: MessageEvent) => {
			if (e.data.type === 'rendered') {
				ctx.putImageData(new ImageData(new Uint8ClampedArray(e.data.data), img.bitmap.width, img.bitmap.height), 0, 0);
				renderer.removeEventListener('message', onMessage);
				progress(layers.length, layers.length, 'Finished!');
				res();
	
				const finishHist = (e: MessageEvent) => {
					histogramWorker.removeEventListener('message', finishHist);
					histogram(e.data);
				};
	
				histogramWorker.addEventListener('message', finishHist);
				histogramWorker.postMessage(e.data.data);
			} else if (e.data.type === 'progress') {
				progress(layers.length, e.data.i, e.data.status, e.data.args);
			}
		};
	
		renderer.addEventListener('message', onMessage, false);
	});
}
