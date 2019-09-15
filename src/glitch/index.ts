import { fxs } from './fxs';

export type Layer = {
	id: string;
	fx: string;
	params: Record<string, any>;
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

	console.log('Rendering...');
	const width = img.bitmap.width;
	const height = img.bitmap.height;
	const bitmap = img.bitmap.data;
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			const idx = (width * y + x) << 2;
			const [r, g, b] = [bitmap[idx + 0], bitmap[idx + 1], bitmap[idx + 2]];
			ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
			ctx.fillRect(x, y, 1, 1);
		}
	}
	console.log('Render finished');
}
