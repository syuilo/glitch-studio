import { Histogram } from '..';

const ctx: Worker = self as any;

ctx.addEventListener('message', e => {
	const image = e.data;

	const bins: Histogram['bins'] = {
		r: [], g: [], b: []
	};

	for (var i = 0; i < 256; i++) {
		bins.r[i] = 0;
		bins.g[i] = 0;
		bins.b[i] = 0;
	}

	for (let i = 0; i < image.length; i += 4) {
		bins.r[image[i]]++;
		bins.g[image[i + 1]]++;
		bins.b[image[i + 2]]++;
	}

	let max = 0;
	for (const ch of ['r' as const, 'g' as const, 'b' as const]) {
		for (let i = 0; i < 256; i++) {
			max = Math.max(max, bins[ch][i]);
		}
	}

	let rAmount = 0;
	let gAmount = 0;
	let bAmount = 0;
	for (let i = 0; i < 256; i++) {
		rAmount += i * bins.r[i];
		gAmount += i * bins.g[i];
		bAmount += i * bins.b[i];
	}
	const amountMax = Math.max(rAmount, gAmount, bAmount);
	const amountMin = Math.min(rAmount, gAmount, bAmount);

	const rMax = Math.max(...bins.r.slice(1, 255)); // 両端はグラフにしたときに邪魔なのでカット
	const gMax = Math.max(...bins.g.slice(1, 255)); // 両端はグラフにしたときに邪魔なのでカット
	const bMax = Math.max(...bins.b.slice(1, 255)); // 両端はグラフにしたときに邪魔なのでカット
	const rgbMax = Math.max(rMax, gMax, bMax);

	ctx.postMessage({
		bins, max, rAmount, gAmount, bAmount, amountMax, amountMin, rMax, gMax, bMax, rgbMax
	});
}, false);

ctx.addEventListener('error', e => {
	ctx.postMessage(e);
}, false);
