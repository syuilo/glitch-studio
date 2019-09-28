import * as math from 'mathjs';
import { Macro, genEmptyValue, Asset, Value } from './core';
import Renderer from 'worker-loader!./workers/renderer';
import HistogramWorker from 'worker-loader!./workers/histogram';
import { fxs } from './fxs';
import { Image } from '@/core';
import { genCacheKey } from '@/gen-cache-key';

export type Layer = {
	id: string;
	fx: string;
	isEnabled: boolean;
	params: Record<string, Value>;
};

export type Histogram = {
	bins: {
		r: number[]; g: number[]; b: number[];
	};
	max: number;
	rAmount: number;
	gAmount: number;
	bAmount: number;
	amountMax: number;
	amountMin: number;
	rMax: number;
	gMax: number;
	bMax: number;
	rgbMax: number;
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

const renderCache = {} as Record<string, Uint8ClampedArray>;
const histogramCache = {} as Record<string, any>;

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

		const hash = genCacheKey(layers, evaluatedParamses);
		console.debug('HASH:', hash);

		const cachedImage = renderCache[hash];
		const cachedHistogram = histogramCache[hash];
		if (cachedImage && cachedHistogram) {
			ctx.putImageData(new ImageData(cachedImage, img.width, img.height), 0, 0);
			progress(layers.length, layers.length, 'Finished!');
			res();
			histogram(cachedHistogram);
			return;
		}

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
				const data = new Uint8ClampedArray(e.data.data);
				renderCache[hash] = data;
				ctx.putImageData(new ImageData(data, img.width, img.height), 0, 0);
				renderer.removeEventListener('message', onMessage);
				progress(layers.length, layers.length, 'Finished!');
				res();
	
				const finishHist = (e: MessageEvent) => {
					const data = e.data;
					histogramWorker.removeEventListener('message', finishHist);
					histogramCache[hash] = data;
					histogram(data);
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
