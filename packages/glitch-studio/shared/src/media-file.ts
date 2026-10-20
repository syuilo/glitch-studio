/** ネイティブ選択後も原本をコピーせず、取り込み時に埋め込み／外部参照を判断するための情報。 */
export type DesktopMediaFile = {
	name: string;
	type: string;
	size: number;
	sourceFilePath: string;
	error: string | null;
};
