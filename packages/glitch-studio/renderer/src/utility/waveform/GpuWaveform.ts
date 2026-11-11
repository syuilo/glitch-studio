import { createWaveform, getWaveformMaximumPositionSamplesPerBin } from '@gs/shared/utility/waveform/waveform.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexShaderCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { DEFAULT_IMAGE_VALUE_RANGE } from '@gs/shared/utility/image-value-scale.ts';
import { getImageAnalysisChunkCount } from '@gs/shared/utility/image-analysis-accumulation.ts';
import { FULL_PREVIEW_WAVEFORM_VIEWPORT, getPreviewWaveformViewportRanges } from '@gs/glitch-studio_shared/preview-waveform-viewport.ts';
import type { PreviewWaveformViewport } from '@gs/glitch-studio_shared/preview-waveform-viewport.ts';
import type { PreviewCanvasContext } from '../../preview-canvas-context.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { GpuImageSampleTransform } from '@gs/shared/gpu/image-sample-transform.ts';

const MAX_SAMPLE_EDGE = 1024;

export function fitWaveformSampleSize(width: number, height: number) {
	const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

// Canvasの所有とプレビュー固有の設定だけを担当する。
export class GpuWaveform {
	private readonly waveform: ReturnType<typeof createWaveform>;

	constructor(
		private readonly device: GPUDevice,
		private readonly context: PreviewCanvasContext,
		format: GPUTextureFormat,
		private readonly positionAxis: 'x' | 'y' = 'x',
		sampleTransform?: GpuImageSampleTransform,
	) {
		context.configure({
			device,
			format,
			alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		this.waveform = createWaveform({ device, vertexShaderModule: device.createShaderModule({ code: vertexShaderCode }), format, sampleTransform });
	}

	public resize(size: Resolution) {
		const canvas = this.context.canvas;
		const width = Math.min(this.device.limits.maxTextureDimension2D, Math.max(1, Math.round(size.width)));
		const height = Math.min(this.device.limits.maxTextureDimension2D, Math.max(1, Math.round(size.height)));
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
	}

	public render(commandEncoder: GPUCommandEncoder, sourceTexture: GPUTexture, valueScale: ImageValueScale = 'srgb', target: ImageAnalysisTarget = 'rgb', valueRange: ImageValueRange = DEFAULT_IMAGE_VALUE_RANGE, fullResolution = false, viewport: PreviewWaveformViewport = FULL_PREVIEW_WAVEFORM_VIEWPORT) {
		const vertical = this.positionAxis === 'y';
		const { positionRange, valueWindow } = getPreviewWaveformViewportRanges(vertical ? 'vertical' : 'horizontal', viewport);
		const positionSpan = positionRange.maximum - positionRange.minimum;
		const valueSpan = valueWindow.maximum - valueWindow.minimum;
		// パネルの縦横比で入力を切り取らず、解析位置は元画像全体を基準にする。
		const input = textureShaderInput(sourceTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: fullResolution ? 'nearest' : 'linear' });
		const regularSampleSize = fitWaveformSampleSize(sourceTexture.width, sourceTexture.height);
		const canvas = this.context.canvas;
		const sampleSize = fullResolution ? sourceTexture : {
			width: vertical ? regularSampleSize.width : Math.max(regularSampleSize.width, Math.min(Math.ceil(canvas.width / positionSpan), sourceTexture.width)),
			height: vertical ? Math.max(regularSampleSize.height, Math.min(Math.ceil(canvas.height / positionSpan), sourceTexture.height)) : regularSampleSize.height,
		};
		const positionSamples = vertical ? sampleSize.height : sampleSize.width;
		const otherSamples = vertical ? sampleSize.width : sampleSize.height;
		// 入力より細かい位置ビンを作ると空の列が縞になるため、位置方向はサンプル数までにする。
		const columns = Math.min(vertical ? canvas.height : canvas.width, Math.max(1, Math.ceil(positionSamples * positionSpan)));
		const chunkCount = getImageAnalysisChunkCount(getWaveformMaximumPositionSamplesPerBin(positionSamples, columns, positionRange) * otherSamples);
		const maximumBufferBytes = Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize);
		// Canvasは表示実寸のままにし、極端な大画面では集計の値方向だけをGPUバッファ上限へ収める。
		const levels = Math.min(vertical ? canvas.width : canvas.height, Math.max(1, Math.floor(maximumBufferBytes / (columns * 3 * 4 * chunkCount))));
		const size = vertical ? { width: levels, height: columns } : { width: columns, height: levels };
		const referencePositionSamples = vertical ? regularSampleSize.height : regularSampleSize.width;
		// 位置・値ビンを増やすと一つのビンへ入る画素数が減る。基準の密度へ戻して、
		// パネルの寸法やDPRだけで波形が薄くならないようにする。小さい入力は空ビンを基準にしない。
		const densityScale = regularSampleSize.width * regularSampleSize.height / (sampleSize.width * sampleSize.height)
			* columns / Math.min(512, referencePositionSamples) * levels / 256
			/ Math.max(positionSpan, 1 / positionSamples) / valueSpan;
		if (this.waveform.prepare(input, {
			fitSize: sourceTexture,
			mode: target,
			valueScale,
			valueRange,
			positionRange,
			valueWindow,
			direction: vertical ? 'vertical' : 'horizontal',
			intensity: 0.22 * densityScale,
			size,
			sampleSize,
		}, commandEncoder)) {
			const pass = commandEncoder.beginComputePass({ label: 'accumulate waveform' });
			this.waveform.accumulate(pass);
			pass.end();
		}
		const pass = commandEncoder.beginRenderPass({
			label: 'render waveform',
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: {
					r: 0,
					g: 0,
					b: 0,
					a: 1,
				},
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		this.waveform.render(pass);
		pass.end();
	}

	public dispose() {
		this.waveform.dispose();
		this.context.unconfigure();
	}
}
