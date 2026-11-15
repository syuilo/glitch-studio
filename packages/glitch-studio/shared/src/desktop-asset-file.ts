/** ネイティブダイアログの選択結果。原本の内容・サイズは取り込み時に読み出す。 */
export type DesktopAssetFile = {
	kind: 'desktop-asset-file';
	path: string;
	name: string;
	type: string;
};

export type AssetFileSelectionOptions = {
	multiple: boolean;
	includeFonts: boolean;
	allowAnyFile: boolean;
};
