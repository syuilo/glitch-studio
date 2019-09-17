import * as math from 'mathjs';
import { Macro, genEmptyValue } from './core';
import Renderer from 'worker-loader!./workers/renderer';
import HistgramWorker from 'worker-loader!./workers/histgram';
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

const renderer = new Renderer();
const histgram = new HistgramWorker();

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
	histogram: HTMLCanvasElement,
	init: (w: number, h: number) => Promise<CanvasRenderingContext2D>,
	progress: (max: number, done: number, status: string) => void
) {
	if (src == null) return;

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

	function drawHistogram(ctx, bins) {
		ctx.clearRect(0, 0, 300, 200);
		var h = histogram.height;
		var sh = 16;
		var baseStr = '#';
		ctx.globalAlpha = 1;
		for(var ch in bins) {
			for(var j=0;j<256;j++) {
				ctx.strokeStyle = baseStr + (j << sh).toString(16);
				ctx.beginPath();
				ctx.moveTo(j, h);
				ctx.lineTo(j, Math.max(0.0, h - bins[ch][j]*h/bins.max));
				ctx.stroke();
				ctx.closePath();
			}
			sh -= 8;
			if(sh < 0) break;
			baseStr += '00';
		}
	}

	const onMessage = (e: MessageEvent) => {
		if (e.data.type === 'rendered') {
			ctx.putImageData(new ImageData(new Uint8ClampedArray(e.data.data), img.bitmap.width, img.bitmap.height), 0, 0);
			renderer.removeEventListener('message', onMessage);
			progress(layers.length, layers.length, 'Finished!');

			const finishHist = (e: MessageEvent) => {
				histgram.removeEventListener('message', finishHist);
				drawHistogram(histogram.getContext('2d'), e.data);
			};

			histgram.addEventListener('message', finishHist);

			histgram.postMessage({
				width: img.bitmap.width,
				height: img.bitmap.height,
				data: e.data.data,
			});
		} else if (e.data.type === 'progress') {
			progress(layers.length, e.data.i, e.data.status);
		}
	};

	renderer.addEventListener('message', onMessage, false);
}
