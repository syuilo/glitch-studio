/** 解析グラフ全体を0〜1とする表示領域。原点は左上。 */
export type PreviewImageAnalysisViewport = { x: number; y: number; width: number; height: number };

export const FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT: Readonly<PreviewImageAnalysisViewport> = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
