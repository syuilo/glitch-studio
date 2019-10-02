const imageType = require('image-type');
import TIFF from 'utif';
import { PNG } from 'pngjs';
import JPEG from 'jpeg-js';
import { Image } from './core';

export function loadImage(image: Buffer): Image {
	const { mime: type } = imageType(image);

	if (type === 'image/png') {
		const png = PNG.sync.read(image);
		return {
			width: png.width,
			height: png.height,
			data: new Uint8Array(png.data),
		};
	} else if (type === 'image/jpeg') {
		return JPEG.decode(image, true);
	} else if (type === 'image/tiff') {
		const ifds = TIFF.decode(image)[0];
		TIFF.decodeImage(image, ifds);
		return {
			width: ifds.width,
			height: ifds.height,
			data: TIFF.toRGBA8(ifds),
		};
	} else {
		throw new Error('Unsupported image type: ' + type);
	}
}
