import * as math from 'mathjs';
import { Macro, genEmptyValue, Asset, Value } from './core';
import Renderer from 'worker-loader!./workers/renderer';
import HistogramWorker from 'worker-loader!./workers/histogram';
import { fxs } from './fxs';
import { Image } from '@/core';

export type Layer = {
	id: string;
	fx: string;
	isEnabled: boolean;
	params: Record<string, Value>;
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
	if (value != null && value.toArray) {
		return value.toArray();
	} else {
		return value;
	}
};

/**
 * Apply FX and render it to a canvas
 */
export async function render(
	src: Image, layers: Layer[], macros: Macro[], assets: Asset[],
	init: (w: number, h: number) => Promise<CanvasRenderingContext2D>,
	histogram: (histogram: Histogram) => void,
	progress: (max: number, done: number, status: string, args?: any) => void
) {
	return new Promise(async (res, rej) => {
		if (src == null) return res();

		let img = {
			width: src.width,
			height: src.height,
			data: src.data.slice(0),
		};
	
		const ctx = await init(img.width, img.height);
	
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
				WIDTH: img.width,
				HEIGHT: img.height,
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

				if (macro.type === 'image') {
					macroScope[macro.name] = assets.find(a => a.id === macroScope[macro.name]);
					console.log(macroScope[macro.name]);
				}
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

				if (paramDefs[k].type === 'image' && v.type === 'literal') {
					evaluatedParams[k] = assets.find(a => a.id === evaluatedParams[k]);
				}
			}
	
			evaluatedParamses.push(evaluatedParams);
		}

		console.debug('EVAL', evaluatedParamses);

		renderer.postMessage({
			img: {
				width: img.width,
				height: img.height,
				data: img.data,
			},
			layers: layers,
			evaluatedParamses
		});
	
		const onMessage = (e: MessageEvent) => {
			if (e.data.type === 'rendered') {
				ctx.putImageData(new ImageData(new Uint8ClampedArray(e.data.data), img.width, img.height), 0, 0);
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
