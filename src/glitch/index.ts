import { fxs } from './fxs';

export type Layer = {
	id: string;
	fx: string;
	params: Record<string, {
		type: 'literal' | 'expression';
		value: any;
	}>;
};

/**
 * Apply FX and render it to a canvas
 */
export async function render(
	src: any, layers: Layer[],
	init: (w: number, h: number) => Promise<CanvasRenderingContext2D>
) {
	let img = src.clone();

	const ctx = await init(img.bitmap.width, img.bitmap.height);

	console.log('Apply FXs...');
	for (const layer of layers) {
		const label = `FX: ${layer.fx}`;
		console.time(label);
		img = fxs[layer.fx].fn(img, layer.params);
		console.timeEnd(label);
	}

	console.time('Render');
	ctx.putImageData(new ImageData(new Uint8ClampedArray(img.bitmap.data), img.bitmap.width, img.bitmap.height), 0, 0);
	console.timeEnd('Render');
}
