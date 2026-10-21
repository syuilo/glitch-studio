import type { Asset } from '@gs/shared/types.ts';

/** プロジェクトの表示用情報・原本パスをWorkerへ持ち込まない。 */
export function getRendererAssets(assets: readonly Asset[]): Asset[] {
	return assets.map(({ id, name, width, height, fileDataType, fileData, hash }) => ({
		id,
		name,
		width,
		height,
		fileDataType,
		fileData,
		hash,
	}));
}
