import { createVideoFrameTexture } from '@gs/shared/media/video-texture.ts';
import type { VideoFrameTexture } from '@gs/shared/media/video-texture.ts';

type PlayerVideoSource = {
	frame: VideoFrame;
	converter: ReturnType<typeof createVideoFrameTexture> | null;
	image: VideoFrameTexture | null;
};

/** Playerのフレームと正規化画像を所有し、使用する全ノードへ同じ画像を貸し出す。 */
export class PlayerVideoTextures {
	private readonly sources = new Map<string, PlayerVideoSource>();
	private readonly versions = new Map<string, number>();
	public get frameVersions(): ReadonlyMap<string, number> { return this.versions; }

	constructor(private readonly device: GPUDevice) {}

	public updateFrame(playerId: string, frame: VideoFrame | null) {
		// timestampが同じ別フレームや、削除後の再追加もキャッシュへ反映する。
		this.versions.set(playerId, (this.versions.get(playerId) ?? 0) + 1);
		const source = this.sources.get(playerId);
		if (source != null && source.frame !== frame) source.frame.close();
		if (frame == null) {
			source?.converter?.dispose();
			this.sources.delete(playerId);
		} else if (source == null) {
			this.sources.set(playerId, { frame, converter: null, image: null });
		} else {
			source.frame = frame;
			source.image = null;
		}
	}

	public getTexture(playerId: string): VideoFrameTexture | null {
		const source = this.sources.get(playerId);
		if (source == null) return null;
		if (source.image == null) {
			// 未使用のPlayerはGPU資源も変換処理も持たない。ノードのFit・解像度変更では
			// 原寸画像を作り直さず、Playerのフレーム更新だけで正規化を無効化する。
			source.converter ??= createVideoFrameTexture(this.device);
			source.image = {
				texture: source.converter.upload(source.frame),
				displayResolution: { width: source.frame.displayWidth, height: source.frame.displayHeight },
			};
		}
		return source.image;
	}

	public dispose() {
		for (const source of this.sources.values()) {
			source.frame.close();
			source.converter?.dispose();
		}
		this.sources.clear();
		this.versions.clear();
	}
}
