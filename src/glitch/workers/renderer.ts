import { fxs } from '../fxs';
import { Layer } from '..';

export type Args = {
	layer: Layer;
	params: Record<string, any>;
	cacheKey: string;
}[];

const ctx: Worker = self as any;

const renderCache = {} as Record<string, Uint8Array>;

function render(input: {
	width: number;
	height: number;
	data: Uint8Array;
}, args: Args, progress: (i: number, status: string, args?: any) => void) {
	if (args.length === 0) return input;

	const apply = (i: number): Uint8Array => {
		if (renderCache[args[i].cacheKey]) return renderCache[args[i].cacheKey];

		if (i > 0) input.data = apply(i - 1);

		const label = `FX: ${args[i].layer.fx}`;
		progress(i, `Applying ${args[i].layer.fx}...`, { processingFxId: args[i].layer.id });

		console.time(label);
		const data = fxs[args[i].layer.fx].fn(input, args[i].params);
		console.timeEnd(label);

		renderCache[args[i].cacheKey] = data;

		return data;
	};

	console.log('Apply FXs...');
	
	input.data = apply(args.length - 1);

	return input;
}

ctx.addEventListener('message', e => {
	const data = e.data;
	const out = render(data.img, data.args, (i: number, status: string, args?: any) => {
		ctx.postMessage({
			type: 'progress',
			i, status, args
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
