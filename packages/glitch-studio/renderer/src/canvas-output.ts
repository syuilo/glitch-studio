/**
 * Canvasへ渡す画素の形式と色空間。表示用の露出・色域圧縮とは独立した出力境界の設定。
 * 現段階では既存の8bit sRGB出力だけを定義し、広色域の有効化は別の改修で追加する。
 */
export type CanvasOutputSettings = Readonly<{
	format: 'rgba8unorm' | 'bgra8unorm';
	colorSpace: 'srgb';
}>;

/** プレビューの選択状態を参照せず、書き出しにも使えるSDRの出力設定を生成する。 */
export function createSrgbCanvasOutputSettings(format: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat()): CanvasOutputSettings {
	if (format !== 'rgba8unorm' && format !== 'bgra8unorm') throw new Error(`Unsupported 8-bit sRGB canvas format: ${format}`);
	return Object.freeze({ format, colorSpace: 'srgb' });
}

/**
 * pipelineと同じ出力設定でCanvasを構成する。alphaModeは背景合成・透明出力の切替だけを担当する。
 * 同じ構成でのconfigureは画像や未完了のCPU読み戻しを失わせるため、繰り返さない。
 */
export function createCanvasOutputConfigurator(device: GPUDevice, context: Pick<GPUCanvasContext, 'configure'>, output: CanvasOutputSettings) {
	const { format, colorSpace } = output;
	let configuredAlphaMode: GPUCanvasAlphaMode | null = null;
	return (alphaMode: GPUCanvasAlphaMode) => {
		if (alphaMode === configuredAlphaMode) return;
		context.configure({ device, format, colorSpace, alphaMode, usage: GPUTextureUsage.RENDER_ATTACHMENT });
		configuredAlphaMode = alphaMode;
	};
}
