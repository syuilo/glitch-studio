import { createWaveform } from '@glitch/shared/utility/waveform/waveform.ts';
import { textureShaderInput } from '@glitch/shared/shader-input.ts';
import vertexShaderCode from '../../vertex.wgsl?raw';

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
		device: GPUDevice,
		private readonly context: GPUCanvasContext,
		format: GPUTextureFormat,
		private readonly positionAxis: 'x' | 'y' = 'x',
	) {
		context.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT });
		this.waveform = createWaveform({ device, vertexShaderModule: device.createShaderModule({ code: vertexShaderCode }), format });
	}

	public render(commandEncoder: GPUCommandEncoder, sourceTexture: GPUTexture) {
		const vertical = this.positionAxis === 'y';
		// パネルの縦横比で画像を切り取らず、常に元画像全体を解析する。
		const input = textureShaderInput(sourceTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' });
		if (this.waveform.prepare(input, {
			fitSize: sourceTexture,
			mode: 'rgb',
			direction: vertical ? 'vertical' : 'horizontal',
			intensity: 0.22,
			size: vertical ? { width: 256, height: 512 } : { width: 512, height: 256 },
			sampleSize: fitWaveformSampleSize(sourceTexture.width, sourceTexture.height),
			showGrid: true,
		}, commandEncoder)) {
			const pass = commandEncoder.beginComputePass({ label: 'accumulate waveform' });
			this.waveform.accumulate(pass);
			pass.end();
		}
		const pass = commandEncoder.beginRenderPass({
			label: 'render waveform',
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
				loadOp: 'clear', storeOp: 'store',
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
