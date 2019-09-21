import { fx, basicParamDefs, makePxGetter } from '../core';

const paramDefs = {
	image: {
		label: 'Image',
		type: 'image' as const,
		default: { type: 'literal' as const, value: null }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { image } = params;

	if (image == null) return;

	const getImagePx = makePxGetter(w, h, image);

	for (let x = 0; x < w; x++) {
		for (let y = 0; y < h; y++) {
			const px = getImagePx(x, y);
			set(x, y, [px[0], px[1], px[2], 255]);
		}
	}
});

export default {
	name: 'overlay',
	displayName: 'Overlay',
	paramDefs,
	fn
};
