import * as Jimp from 'jimp';
import swap from './fx/swap';

export async function render(src: string) {
	let img = await Jimp.default.read(src);

	img = swap(img);

	return img;
}
