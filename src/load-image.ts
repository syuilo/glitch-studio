const imageType = require('image-type');
import { PNG } from 'pngjs';
import JPEG from 'jpeg-js';
import { Image } from './core';

export function loadImage(image: Buffer): Image {
	const { mime: type } = imageType(image);

	console.log(type);
	
	if (type === 'image/png') {
		const png = PNG.sync.read(image);
		return {
			width: png.width,
			height: png.height,
			data: new Uint8Array(png.data),
		};
	} else if (type === 'image/jpeg') {
		return JPEG.decode(image, true);
	} else {
		throw new Error('Unsupported image type: ' + type);
	}
}
