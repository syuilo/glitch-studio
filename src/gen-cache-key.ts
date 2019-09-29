import hasha from 'hasha';
import { Layer } from './glitch';

export function genCacheKey(srcImgHash: string, layers: Layer[], paramsList: Record<string, any>[]) {
	const data = [];

	for (let i = 0; i < layers.length; i++) {
		const layer = layers[i];
		
		if (!layer.isEnabled) continue;

		data.push({
			fx: layer.fx,
			params: paramsList[i]
		});
	}

	const serializedParamsList = JSON.stringify(data, (key, value) => {
		if (Buffer.isBuffer(value)) return undefined;
		if (value instanceof Uint8Array) return undefined;
		return value;
	});

	return hasha(srcImgHash + serializedParamsList, {
		algorithm: 'md5'
	});
}
