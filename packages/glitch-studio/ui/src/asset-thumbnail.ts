/** プロジェクトの素材一覧で使う縮小画像。レンダラーへは渡さない。 */
export type AssetThumbnailSequence = {
	width: number;
	height: number;
	frames: {
		timestampSeconds: number;
		fileData: Blob;
	}[];
};
