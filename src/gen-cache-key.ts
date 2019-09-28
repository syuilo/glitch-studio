import hasha from 'hasha';
import { Layer } from './glitch';

export function genCacheKey(layers: Layer[], paramses: Record<string, any>[]) {
	const data = [];

	for (let i = 0; i < layers.length; i++) {
		const layer = layers[i];
		
		if (!layer.isEnabled) continue;

		data.push({
			fx: layer.fx,
			params: paramses[i]
		});
	}

	return hasha(JSON.stringify(data), { algorithm: 'md5' });
}
