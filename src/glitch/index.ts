import * as Jimp from 'jimp';

const swap = createFx('swap', (w, h, get, set) => {
	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const [r, g, b] = get(x, y);
			set(x, y, [b, g, r]);
		}
	}
});

export async function render(src: string) {
	let img = await Jimp.default.read(src);

	img = swap(img);

	return img;
}

type Pixel = [number, number, number];

type FX = (
	width: number, height: number,
	get: (x: number, y: number) => Pixel, set: (x: number, y: number, color: Pixel) => void,
	params: Record<string, any>
) => void;

function createFx(name: string, fx: FX) {
	return (input) => {
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

		const label = `FX: ${name}`;
		console.time(label);
		fx(input.bitmap.width, input.bitmap.height, get, set, {});
		console.timeEnd(label);

		return output;
	}
}
