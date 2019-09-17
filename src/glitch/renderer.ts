import { fxs } from './fxs';
import { Layer } from '.';

const ctx: Worker = self as any;

function render(input: {
	width: number;
	height: number;
	data: Uint8Array;
}, layers: Layer[], paramses: Record<string, any>[], progress: (i: number, status: string) => void) {
	console.log('Apply FXs...');
	let i = 0;
	for (const layer of layers) {
		if (!layer.isEnabled) { i++; continue; } // Skip disabled effect

		progress(i, `Applying ${layer.fx}...`);
		const startTime = performance.now();
		input.data = fxs[layer.fx].fn(input, paramses[i]);
		const endTime = performance.now();
		console.log(`FX: ${layer.fx}`, endTime - startTime);
		i++;
	}
	return input;
}

ctx.addEventListener('message', e => {
	const data = e.data;
	const out = render(data.img, data.layers, data.evaluatedParamses, (i: number, status: string) => {
		ctx.postMessage({
			type: 'progress',
			i, status
		});
	});
	ctx.postMessage({
		type: 'rendered',
		data: out.data
	});
}, false);

ctx.addEventListener('error', e => {
	ctx.postMessage(e);
}, false);
