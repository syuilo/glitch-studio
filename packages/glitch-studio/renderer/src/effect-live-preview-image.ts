import { createVideoFrameTexture } from '@gs/shared/media/video-texture.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectTextureOutput } from '@gs/subsystems_effect_renderer/effect-instance.ts';

export type EffectLivePreviewImageSource = { kind: 'asset'; assetId: string } | { kind: 'frame'; frame: VideoFrame } | null;

/** 1回の描画に同じ原寸画像を貸し出す。変換は画像が参照された時だけ行う。 */
export class EffectLivePreviewImage {
	private frame: VideoFrame | null = null;
	private converter: ReturnType<typeof createVideoFrameTexture> | null = null;
	private currentTexture: GPUTexture | null = null;
	private transparentTexture: GPUTexture | null = null;
	private resolution: Resolution = { width: 1, height: 1 };
	private version = 0;

	constructor(private readonly device: GPUDevice) {}

	public update(frame: VideoFrame | null, assetTexture: GPUTexture | null): boolean {
		if (this.frame !== frame) this.frame?.close();
		this.frame = frame;
		if (frame == null) {
			this.converter?.dispose();
			this.converter = null;
		}
		this.currentTexture = assetTexture;
		this.version++;
		const width = frame?.displayWidth ?? assetTexture?.width ?? 1;
		const height = frame?.displayHeight ?? assetTexture?.height ?? 1;
		if (width === this.resolution.width && height === this.resolution.height) return false;
		this.resolution = { width, height };
		return true;
	}

	public bind(): EffectTextureOutput {
		const readVersion = () => this.version;
		const readTexture = () => this.getTexture();
		return {
			kind: 'texture',
			resolution: this.resolution,
			get version() { return readVersion(); },
			get texture() { return readTexture(); },
		};
	}

	private getTexture(): GPUTexture {
		if (this.currentTexture != null) return this.currentTexture;
		if (this.frame != null) {
			this.converter ??= createVideoFrameTexture(this.device);
			this.currentTexture = this.converter.upload(this.frame);
			return this.currentTexture;
		}
		return this.transparentTexture ??= this.device.createTexture({
			size: [1, 1], format: INTERMEDIATE_TEXTURE_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING,
		});
	}

	public dispose() {
		this.frame?.close();
		this.frame = null;
		this.converter?.dispose();
		this.converter = null;
		this.currentTexture = null;
		this.transparentTexture?.destroy();
		this.transparentTexture = null;
	}
}
