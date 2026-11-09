/** 解析用の座標軸。画像の保存値やプレビュー露出を変更しない。EVの0はlinear 0.18。 */
export const IMAGE_VALUE_SCALES = ['srgb', 'linear', 'ev', 'linearZeroToOne', 'linearMinusOneToOne'] as const;
export type ImageValueScale = (typeof IMAGE_VALUE_SCALES)[number];
