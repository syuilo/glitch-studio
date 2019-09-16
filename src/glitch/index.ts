import { fxs } from './fxs';
import { Macro } from './core';

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
	src: any, layers: Layer[], macros: Macro[],
	init: (w: number, h: number) => Promise<CanvasRenderingContext2D>,
	progress: (max: number, done: number, status: string) => Promise<void>
) {
	if (src == null) return;

	let img = src.clone();

	const ctx = await init(img.bitmap.width, img.bitmap.height);

	console.log('Apply FXs...');
	let i = 0;
	for (const layer of layers) {
		const label = `FX: ${layer.fx}`;
		await progress(layers.length, i, `Applying ${layer.fx}...`);
		console.time(label);
		img = fxs[layer.fx].fn(img, layer.params, macros);
		console.timeEnd(label);
		i++;
	}

	await progress(layers.length, i, 'Rendering...');

	console.time('Render');
	ctx.putImageData(new ImageData(new Uint8ClampedArray(img.bitmap.data), img.bitmap.width, img.bitmap.height), 0, 0);
	console.timeEnd('Render');

	progress(layers.length, i, 'Finished!');
}
