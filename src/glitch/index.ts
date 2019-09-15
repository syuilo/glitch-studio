import * as Jimp from 'jimp';
import swap from './fx/swap';
import tear from './fx/tear';
import tearBulk from './fx/tear-bulk';

export async function render(src: string) {
	let img = await Jimp.default.read(src);

	img = swap(img);
	img = tear(img);
	img = tearBulk(img);

	return img;
}
