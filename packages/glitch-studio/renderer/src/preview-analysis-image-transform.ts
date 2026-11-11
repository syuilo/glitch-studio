import type { GpuImageSampleTransform } from '@gs/shared/gpu/image-sample-transform.ts';
import type { PreviewImageAdjustmentSettings } from '@gs/glitch-studio_shared/preview-image-adjustment.ts';
import oklabCode from '@gs/shared/gpu/oklab.wgsl?raw';
import compressionCode from './preview-gamut-compression.wgsl?raw';
import adjustmentCode from './preview-image-adjustment.wgsl?raw';
import { getPreviewGamutCompressionModeIndex, PREVIEW_GAMUT_COUNT, PREVIEW_GAMUT_HUE_STEPS, PREVIEW_GAMUT_LIGHTNESS_STEPS } from './preview-gamut-compression.ts';
import type { PreviewGamutCompressionResources } from './preview-gamut-compression-resources.ts';

/** 解析のサンプルへ表示調整を適用する。全画面の中間画像や8bitの表示Canvasを経由しない。 */
export class PreviewAnalysisImageTransform implements GpuImageSampleTransform {
	public readonly bindGroupLayout: GPUBindGroupLayout;
	private readonly uniformBuffer: GPUBuffer;
	private readonly values = new ArrayBuffer(32);
	private boundaryBuffer: GPUBuffer | null = null;
	private bindGroup: GPUBindGroup | null = null;
	private mode = 0;

	constructor(private readonly device: GPUDevice, private readonly gamutResources: PreviewGamutCompressionResources) {
		this.uniformBuffer = device.createBuffer({ size: this.values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		this.bindGroupLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
		] });
	}

	public update(settings: PreviewImageAdjustmentSettings | null) {
		this.mode = settings == null || settings.srgbProof ? 0 : getPreviewGamutCompressionModeIndex(settings.gamutCompression.mode);
		const integers = new Uint32Array(this.values);
		integers.set([settings == null ? 0 : 1, 0, settings?.srgbProof === true ? 1 : 0, this.mode, 0, PREVIEW_GAMUT_HUE_STEPS, PREVIEW_GAMUT_LIGHTNESS_STEPS, PREVIEW_GAMUT_COUNT]);
		const floats = new Float32Array(this.values);
		floats[1] = settings?.exposure ?? 0;
		floats[4] = Math.max(0, Math.min(1, settings?.gamutCompression.customAmount ?? 0));
		this.device.queue.writeBuffer(this.uniformBuffer, 0, this.values);
	}

	public getShaderCode(bindGroupIndex: number): string {
		return `${oklabCode}\n${compressionCode}\n${adjustmentCode}\n
struct PreviewAnalysisAdjustmentUniforms {
	enabled: u32, exposure: f32, srgbProof: u32, mode: u32,
	amount: f32, hueSteps: u32, lightnessSteps: u32, gamutCount: u32,
};
@group(${bindGroupIndex}) @binding(0) var<uniform> previewAnalysisAdjustment: PreviewAnalysisAdjustmentUniforms;
@group(${bindGroupIndex}) @binding(1) var<storage, read> previewGamutBoundaries: array<f32>;
fn transformImageSample(input: vec4f) -> vec4f {
	if (previewAnalysisAdjustment.enabled == 0u) { return input; }
	let settings = previewAnalysisAdjustment;
	let compression = PreviewGamutCompressionUniforms(settings.mode, settings.amount, vec2u(settings.hueSteps, settings.lightnessSteps), settings.gamutCount);
	return adjustPreviewImage(input, settings.exposure, settings.srgbProof != 0u, compression);
}`;
	}

	public getBindGroup(): GPUBindGroup {
		const boundaryBuffer = this.gamutResources.getBuffer(this.mode);
		if (this.bindGroup == null || this.boundaryBuffer !== boundaryBuffer) {
			this.boundaryBuffer = boundaryBuffer;
			this.bindGroup = this.device.createBindGroup({ layout: this.bindGroupLayout, entries: [
				{ binding: 0, resource: { buffer: this.uniformBuffer } }, { binding: 1, resource: { buffer: boundaryBuffer } },
			] });
		}
		return this.bindGroup;
	}

	public dispose() { this.uniformBuffer.destroy(); }
}
