import { Asset } from './glitch/core';
import { loadImage } from './load-image';

export function decodeAssets(assets: Asset[]) {
	return assets.map(asset => ({
		id: asset.id,
		name: asset.name,
		width: asset.width,
		height: asset.height,
		data: loadImage(asset.buffer).data,
		buffer: asset.buffer,
	}));
}
