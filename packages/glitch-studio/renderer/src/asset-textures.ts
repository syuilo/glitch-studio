import type { Asset } from '@gs/shared/types.ts';
import { getFileSourceError, readFileSource } from '@gs/shared/file-source.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createExternalImageToLinearTextureConverter } from '@gs/shared/media/external-image-texture.ts';

/** 素材一覧は生成時に固定し、ready完了後のGPUテクスチャをレンダラーへ貸し出す。 */
export class AssetTextures {
	private readonly preparedTextures = new Map<string, GPUTexture>();
	public get textures(): ReadonlyMap<string, GPUTexture> { return this.preparedTextures; }
	public readonly ready: Promise<void>;
	private disposed = false;

	constructor(private readonly device: GPUDevice, assets: readonly Asset[]) {
		this.ready = this.prepare(assets);
	}

	/** デコード自体は中断できなくても、Managerの生成待機は中断して所有者へ解放を委ねる。 */
	public async waitUntilReady(signal?: AbortSignal): Promise<void> {
		if (signal == null) return this.ready;
		signal.throwIfAborted();
		const { promise: aborted, reject } = Promise.withResolvers<never>();
		const onAbort = () => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		try {
			await Promise.race([this.ready, aborted]);
			signal.throwIfAborted();
		} finally {
			signal.removeEventListener('abort', onAbort);
		}
	}

	private async prepare(assets: readonly Asset[]): Promise<void> {
		let converter: ReturnType<typeof createExternalImageToLinearTextureConverter> | null = null;
		try {
			// 大きな画像を同時にすべてデコードすると、一時メモリが膨らむため順番に処理する。
			for (const asset of assets) {
				if (this.disposed) return;
				if (!asset.fileDataType.startsWith('image/')) continue;
				if (getFileSourceError(asset.fileData) != null) continue;
				let bitmap: ImageBitmap;
				// Chrome 157ではpremultiplyAlpha: 'none'にすると、半透明の広色域PNGを後段で
				// sRGBへ変換する際に暗くなる。既定のデコードを使い、原色変換とalphaの整合性を保つ。
				try { bitmap = await createImageBitmap(asset.fileData instanceof Blob ? asset.fileData : await readFileSource(asset.fileData)); } catch (error) {
					// 未使用の外部画像の障害で全体を停止しない。使用時にはテクスチャの欠落をエラーにする。
					if (asset.fileData instanceof Blob) throw error;
					continue;
				}
				try {
					// デコードは中断できないため、破棄後に完了した画像ではGPUを使わずBitmapだけ閉じる。
					if (this.disposed) return;
					const texture = this.device.createTexture({
						size: [bitmap.width, bitmap.height],
						format: INTERMEDIATE_TEXTURE_FORMAT,
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
					});
					this.preparedTextures.set(asset.id, texture);
					// 原色・伝達関数の変換とpremultiplyを補間より前に済ませる。
					// float保存により、広色域素材からの変換で生じるHDR・負値も保持する。
					converter ??= createExternalImageToLinearTextureConverter(this.device);
					converter.copy(bitmap, texture);
				} finally {
					bitmap.close();
				}
			}
		} catch (error) {
			if (this.disposed) return;
			this.dispose();
			throw error;
		} finally {
			converter?.dispose();
		}
	}

	public dispose() {
		this.disposed = true;
		for (const texture of this.preparedTextures.values()) texture.destroy();
		this.preparedTextures.clear();
	}
}
