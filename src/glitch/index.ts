import * as Jimp from 'jimp';
import swap from './fx/swap';
import tear from './fx/tear';
import tearBulk from './fx/tear-bulk';

export async function render(src: string, init) {
	let img = await Jimp.default.read(src);

	const ctx = await init(img.bitmap.width, img.bitmap.height);

	console.log('Apply FXs...');
	img = swap(img);
	img = tear(img);
	img = tearBulk(img);

	console.log('Rendering...');
	for (let x = 0; x < img.bitmap.width; x++) {
		for (let y = 0; y < img.bitmap.height; y++) {
			const idx = (img.bitmap.width * y + x) << 2;
			const [r, g, b] = [img.bitmap.data[idx + 0], img.bitmap.data[idx + 1], img.bitmap.data[idx + 2]];
			ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
			ctx.fillRect(x, y, 1, 1);
		}
	}
}
