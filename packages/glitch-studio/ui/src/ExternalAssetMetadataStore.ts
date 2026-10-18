import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { ProjectAsset } from './Project.ts';

type ExternalAssetMetadata = Pick<ProjectAsset, 'width' | 'height' | 'fileDataType' | 'thumbnailSequence' | 'hash'>;

/** 外部原本から得た最新情報を、編集履歴とは別にプロジェクトの存続中だけ保持する。 */
export class ExternalAssetMetadataStore {
	private readonly metadataByAssetId = new Map<ProjectAsset['id'], Map<string, ExternalAssetMetadata>>();

	public reset(assets: readonly ProjectAsset[]): void {
		this.metadataByAssetId.clear();
		for (const asset of assets) this.record(asset);
	}

	/** 取り込み・再リンク・リロードが完了した時点の情報だけを採用する。 */
	public record(asset: ProjectAsset): void {
		if (!asset.isExternalReference || asset.sourceFilePath == null) return;
		let metadataByPath = this.metadataByAssetId.get(asset.id);
		if (metadataByPath == null) {
			metadataByPath = new Map();
			this.metadataByAssetId.set(asset.id, metadataByPath);
		}
		metadataByPath.set(asset.sourceFilePath, deepClone({
			width: asset.width,
			height: asset.height,
			fileDataType: asset.fileDataType,
			thumbnailSequence: asset.thumbnailSequence,
			hash: asset.hash,
		}));
	}

	/** Commandの実行・Undo・Redoの直後、ほかの購読側が状態を使う前に適用する。 */
	public apply(assets: readonly ProjectAsset[]): void {
		for (const asset of assets) {
			if (!asset.isExternalReference || asset.sourceFilePath == null) continue;
			const metadata = this.metadataByAssetId.get(asset.id)?.get(asset.sourceFilePath);
			if (metadata == null) {
				this.record(asset);
			} else {
				// モード・パス・表示名はCommandの結果を保ち、過去のスナップショットに
				// 含まれる寸法やサムネイルだけを上書きする。別アセットや別パスとは共有しない。
				// 原本のバイト列は保持せず、URLとエラーはresolveExternalAssetsが解決し直す。
				Object.assign(asset, metadata);
			}
		}
	}
}
