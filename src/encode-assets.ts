import { Asset } from './glitch/core';

export function encodeAssets(assets: Asset[]) {
	return assets.map(asset => ({
		id: asset.id,
		name: asset.name,
		width: asset.width,
		height: asset.height,
		buffer: asset.buffer,
		hash: asset.hash,
	}));
}
