import { Histogram } from '..';

const ctx: Worker = self as any;

ctx.addEventListener('message', e => {
	const image = e.data;

	const bins: Histogram['bins'] = {
		v1: [], v2: [], v3: []
	};

	for (var i = 0; i < 256; i++) {
		bins.v1[i] = 0;
		bins.v2[i] = 0;
		bins.v3[i] = 0;
	}

	for (let i = 0; i < image.length; i += 4) {
		bins.v1[image[i]]++;
		bins.v2[image[i + 1]]++;
		bins.v3[image[i + 2]]++;
	}

	let max = 0;
	for (const ch of ['v1' as const, 'v2' as const, 'v3' as const]) {
		for (let i = 0; i < 256; i++) {
			max = Math.max(max, bins[ch][i]);
		}
	}

	let rAmount = 0;
	let gAmount = 0;
	let bAmount = 0;
	for (let i = 0; i < 256; i++) {
		rAmount += i * bins.v1[i];
		gAmount += i * bins.v2[i];
		bAmount += i * bins.v3[i];
	}
	const amountMax = Math.max(rAmount, gAmount, bAmount);
	const amountMin = Math.min(rAmount, gAmount, bAmount);

	ctx.postMessage({
		bins, max, rAmount, gAmount, bAmount, amountMax, amountMin
	});
}, false);

ctx.addEventListener('error', e => {
	ctx.postMessage(e);
}, false);
