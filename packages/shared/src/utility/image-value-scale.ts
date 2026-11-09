/** 解析用の座標軸。画像の保存値やプレビュー露出を変更しない。EVの0はlinear 0.18。 */
export type ImageValueScale = 'srgb' | 'linear' | 'ev';
export const IMAGE_VALUE_SCALES = ['srgb', 'linear', 'ev'] as const;
