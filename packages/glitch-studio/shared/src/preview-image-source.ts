/** プレビューの診断元。originalも素材ではなく、表示補正前のレンダリング画像を指す。 */
export const PREVIEW_IMAGE_SOURCES = ['original', 'previewAdjusted'] as const;
export type PreviewImageSource = typeof PREVIEW_IMAGE_SOURCES[number];
