/**
 * Canvasへ渡す画素の形式と色空間。表示用の露出・色域圧縮とは独立した出力境界の設定。
 * GPUプレビューは拡張sRGBのfloat、CPU表示・SDR書き出しは範囲を制限した8bit sRGBを使う。
 */
export type CanvasOutputSettings = Readonly<{
	format: 'rgba8unorm' | 'bgra8unorm' | 'rgba16float';
	colorSpace: 'srgb';
}>;

/** プレビューの選択状態を参照せず、書き出しにも使えるSDRの出力設定を生成する。 */
export function createSrgbCanvasOutputSettings(format: GPUTextureFormat = navigator.gpu.getPreferredCanvasFormat()): CanvasOutputSettings {
	if (format !== 'rgba8unorm' && format !== 'bgra8unorm') throw new Error(`Unsupported 8-bit sRGB canvas format: ${format}`);
	return Object.freeze({ format, colorSpace: 'srgb' });
}

/**
 * sRGB原色でも、floatなら負値・1超の成分でsRGB色域外のP3等の色を表せる。
 * モニターへの変換はブラウザーに委ね、P3への事前clampや画面の能力判定を挟まない。
 * 線形Canvasのenumをまだ受け付けないElectronでも同じ経路を使えるよう、伝達関数はsRGBとする。
 */
export function createGpuPreviewCanvasOutputSettings(): CanvasOutputSettings {
	return Object.freeze({ format: 'rgba16float', colorSpace: 'srgb' });
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
		// 広色域とHDRの輝度拡張は別。モニター色空間へ変換した後のSDR範囲に表示する。
		context.configure({ device, format, colorSpace, alphaMode, toneMapping: { mode: 'standard' }, usage: GPUTextureUsage.RENDER_ATTACHMENT });
		configuredAlphaMode = alphaMode;
	};
}
