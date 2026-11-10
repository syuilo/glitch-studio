import { createWaveform } from '@gs/shared/utility/waveform/waveform.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexShaderCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { DEFAULT_IMAGE_VALUE_RANGE } from '@gs/shared/utility/image-value-scale.ts';
import { getImageAnalysisChunkCount } from '@gs/shared/utility/image-analysis-accumulation.ts';
import type { PreviewCanvasContext } from '../../preview-canvas-context.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

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
	) {
		context.configure({
			device,
			format,
			alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});
		this.waveform = createWaveform({ device, vertexShaderModule: device.createShaderModule({ code: vertexShaderCode }), format });
	}

	public resize(size: Resolution) {
		const canvas = this.context.canvas;
		const width = Math.min(this.device.limits.maxTextureDimension2D, Math.max(1, Math.round(size.width)));
		const height = Math.min(this.device.limits.maxTextureDimension2D, Math.max(1, Math.round(size.height)));
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
	}

	public render(commandEncoder: GPUCommandEncoder, sourceTexture: GPUTexture, valueScale: ImageValueScale = 'srgb', target: ImageAnalysisTarget = 'rgb', valueRange: ImageValueRange = DEFAULT_IMAGE_VALUE_RANGE, fullResolution = false) {
		const vertical = this.positionAxis === 'y';
		// パネルの縦横比で画像を切り取らず、常に元画像全体を解析する。
		const input = textureShaderInput(sourceTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: fullResolution ? 'nearest' : 'linear' });
		const regularSampleSize = fitWaveformSampleSize(sourceTexture.width, sourceTexture.height);
		const canvas = this.context.canvas;
		const sampleSize = fullResolution ? sourceTexture : {
			width: vertical ? regularSampleSize.width : Math.max(regularSampleSize.width, Math.min(canvas.width, sourceTexture.width)),
			height: vertical ? Math.max(regularSampleSize.height, Math.min(canvas.height, sourceTexture.height)) : regularSampleSize.height,
		};
		const positionSamples = vertical ? sampleSize.height : sampleSize.width;
		const otherSamples = vertical ? sampleSize.width : sampleSize.height;
		// 入力より細かい位置ビンを作ると空の列が縞になるため、位置方向はサンプル数までにする。
		const columns = Math.min(vertical ? canvas.height : canvas.width, positionSamples);
		const chunkCount = getImageAnalysisChunkCount(Math.ceil(positionSamples / columns) * otherSamples);
		const maximumBufferBytes = Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize);
		// Canvasは表示実寸のままにし、極端な大画面では集計の値方向だけをGPUバッファ上限へ収める。
		const levels = Math.min(vertical ? canvas.width : canvas.height, Math.max(1, Math.floor(maximumBufferBytes / (columns * 3 * 4 * chunkCount))));
		const size = vertical ? { width: levels, height: columns } : { width: columns, height: levels };
		const referencePositionSamples = vertical ? regularSampleSize.height : regularSampleSize.width;
		// 位置・値ビンを増やすと一つのビンへ入る画素数が減る。基準の密度へ戻して、
		// パネルの寸法やDPRだけで波形が薄くならないようにする。小さい入力は空ビンを基準にしない。
		const densityScale = regularSampleSize.width * regularSampleSize.height / (sampleSize.width * sampleSize.height)
			* columns / Math.min(512, referencePositionSamples) * levels / 256;
		if (this.waveform.prepare(input, {
			fitSize: sourceTexture,
			mode: target,
			valueScale,
			valueRange,
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
