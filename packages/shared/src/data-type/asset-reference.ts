import { LUT_ASSET_MIME_TYPE } from '../media/lut.ts';
import type { AssetReferenceDataType } from '../static-setting.ts';

const assetReferenceMimeTypes = {
	image: 'image/*',
	font: 'font/*',
	lut: LUT_ASSET_MIME_TYPE,
	video: 'video/*',
} as const satisfies Record<AssetReferenceDataType['assetType'], string>;

// 選択候補と実際に受け付ける素材の種類がずれないよう、同じMIME制約を使う。
export function getAssetReferenceMimeType(dataType: AssetReferenceDataType): string {
	return assetReferenceMimeTypes[dataType.assetType];
}

export function matchesAssetReferenceMimeType(dataType: AssetReferenceDataType, mimeType: string): boolean {
	const expectedMimeType = getAssetReferenceMimeType(dataType);
	return expectedMimeType.endsWith('/*')
		? mimeType.startsWith(expectedMimeType.slice(0, -1))
		: mimeType === expectedMimeType;
}
