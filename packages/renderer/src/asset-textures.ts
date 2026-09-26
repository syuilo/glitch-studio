import type { Asset } from '@glitch/shared/types.ts';

/** 画像の原本から作ったGPUリソースだけを所有し、デコード済み画素をプロジェクトへ持ち込まない。 */
export class AssetTextures {
	// VisualModuleRendererが参照するため、更新時もMap自体は置き換えない。
	public readonly textures = new Map<string, GPUTexture>();
	private generation = 0;
	private disposed = false;

	constructor(private readonly device: GPUDevice) {}

	public async update(assets: readonly Asset[], onCommit: () => void): Promise<boolean> {
		if (this.disposed) return false;
		const generation = ++this.generation;
		const pending = new Map<string, GPUTexture>();
		let prepared = false;
		const isCurrent = () => !this.disposed && generation === this.generation;
		try {
			// 大きな画像を同時にすべてデコードすると、一時メモリが膨らむため順番に処理する。
			for (const asset of assets) {
				if (!asset.fileDataType.startsWith('image/')) continue;
				const bitmap = await createImageBitmap(asset.fileData);
				try {
					if (!isCurrent()) return false;
					const texture = this.device.createTexture({
						size: [bitmap.width, bitmap.height],
						format: 'rgba8unorm',
						usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
					});
					pending.set(asset.id, texture);
					// 補間より前にpremultiplyする。画像ノードではこのRGBAをそのまま読む。
					this.device.queue.copyExternalImageToTexture(
						{ source: bitmap },
						{ texture, premultipliedAlpha: true, colorSpace: 'srgb' },
						[bitmap.width, bitmap.height],
					);
				} finally {
					bitmap.close();
				}
			}
			if (!isCurrent()) return false;
			prepared = true;
		} catch (error) {
			// 差し替え・削除・破棄後に失敗した古いデコードは、現在のAssetのエラーではない。
			if (isCurrent()) throw error;
			return false;
		} finally {
			// 成功した最新の準備だけを下で引き継ぐ。失敗時も旧テクスチャは維持する。
			if (!prepared) {
				for (const texture of pending.values()) texture.destroy();
			}
		}

		const previous = [...this.textures.values()];
		this.textures.clear();
		for (const [id, texture] of pending) this.textures.set(id, texture);
		try {
			// Map・Asset一覧・参照キャッシュの切り替えの間に、別の更新や描画を挟まない。
			onCommit();
		} finally {
			for (const texture of previous) texture.destroy();
		}
		return true;
	}

	public dispose() {
		this.disposed = true;
		this.generation++;
		for (const texture of this.textures.values()) texture.destroy();
		this.textures.clear();
	}
}
