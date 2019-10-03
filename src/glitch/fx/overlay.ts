import { fx, basicParamDefs, makePxGetter } from '../core';

const paramDefs = {
	image: {
		label: 'Image',
		type: 'image' as const,
		default: { type: 'literal' as const, value: null }
	},
	align: {
		label: 'Align',
		type: 'enum' as const,
		options: [{
			label: 'Center',
			value: 'center',
		}, {
			label: 'Left',
			value: 'left',
		}, {
			label: 'Right',
			value: 'right',
		}, {
			label: 'Top',
			value: 'top',
		}, {
			label: 'Bottom',
			value: 'bottom',
		}],
		default: { type: 'literal' as const, value: 'center' }
	},

	...basicParamDefs,
};

const fn = fx((w, h, get, set, params) => {
	const { image, align } = params;

	if (image == null) return;

	const getImagePx = makePxGetter(w, h, image, align);

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
