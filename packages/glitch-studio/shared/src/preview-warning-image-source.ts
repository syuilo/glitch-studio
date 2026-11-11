/** 黒・白と色域外の両警告が比較する画像。originalも素材ではなく合成済みのレンダリング画像を指す。 */
export const PREVIEW_WARNING_IMAGE_SOURCES = ['original', 'previewAdjusted'] as const;
export type PreviewWarningImageSource = typeof PREVIEW_WARNING_IMAGE_SOURCES[number];
