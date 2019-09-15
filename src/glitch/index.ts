import * as Jimp from 'jimp';

export async function render(src: string) {
	const img = await Jimp.default.read(src);

	const out = img.clone();

	console.time('test');
	function getPx(x, y) {
		const idx = (img.bitmap.width * y + x) << 2;
		return [img.bitmap.data[idx + 0], img.bitmap.data[idx + 1], img.bitmap.data[idx + 2]];
	}
	function setPx(x, y, rgb) {
		const idx = (img.bitmap.width * y + x) << 2;
		out.bitmap.data[idx + 0] = rgb[0];
		out.bitmap.data[idx + 1] = rgb[1];
		out.bitmap.data[idx + 2] = rgb[2];
	}
	for (let x = 0; x < img.bitmap.width; x++) {
		for (let y = 0; y < img.bitmap.height; y++) {
			const [r, g, b] = getPx(x, y);
			setPx(x, y, [b, g, r]);
		}
	}
	console.timeEnd('test');

	return out;
}
