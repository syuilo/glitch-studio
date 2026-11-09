import type { TimelinePreviewFrameCachePrecision, TimelinePreviewFrameRange } from '@gs/glitch-studio_shared/timeline-preview-frame.ts';

export type TimelinePreviewCachedFrame<Metadata> = { texture: GPUTexture; metadata: Metadata; bytes: number };

const textureBytesPerPixel: Partial<Record<GPUTextureFormat, number>> = {
	r8unorm: 1, rg8unorm: 2, rgba8unorm: 4, bgra8unorm: 4, 'rgba8unorm-srgb': 4, 'bgra8unorm-srgb': 4,
	r16float: 2, rg16float: 4, rgba16float: 8,
	r32float: 4, rg32float: 8, rgba32float: 16,
};

/** 最終画像の複製だけを所有する。Scene・編集・精密シークの方針はManagerが決める。 */
export class TimelinePreviewFrameCache<Metadata> {
	private frames = new Map<number, TimelinePreviewCachedFrame<Metadata>>();
	private pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
	private estimatedBytes = 0;
	public changed = false;

	constructor(private device: GPUDevice, private vertex: GPUShaderModule,
		private readonly maxBytes: number, private readonly precision: TimelinePreviewFrameCachePrecision = 'original') {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid frame cache capacity');
	}

	get enabled() { return this.maxBytes > 0; }

	get(frameIndex: number) {
		const frame = this.frames.get(frameIndex) ?? null;
		if (frame != null) {
			this.frames.delete(frameIndex);
			this.frames.set(frameIndex, frame);
		}
		return frame;
	}

	/** 借用出力は次の評価で上書きされるので、次の評価より先に複製をsubmitすること。 */
	capture(encoder: GPUCommandEncoder, source: GPUTexture, metadata: Metadata): TimelinePreviewCachedFrame<Metadata> | null {
		// 無変形Replaceではデータ用のR/RGテクスチャも最終画像として借用される。
		const sourceBytesPerPixel = textureBytesPerPixel[source.format];
		if (sourceBytesPerPixel == null) return null;
		// 8bitでは暗部の階調を確保するため、乗算済みlinear RGBをsRGB形式で保存する。
		// 参照時の自動decodeで元のlinear・premultiplied規約へ戻る。unpremultiplyしないため、
		// alpha=0の発光もRGBの保存範囲内では保持できる。alpha自体は線形の8bit値になる。
		const destinationFormat = this.precision === '8bit' ? 'rgba8unorm-srgb' : source.format;
		const bytesPerPixel = this.precision === '8bit' ? 4 : sourceBytesPerPixel;
		const bytes = source.width * source.height * bytesPerPixel;
		if (bytes > this.maxBytes || !this.enabled) return null;
		this.trim(bytes);
		let pipeline = this.pipelines.get(destinationFormat);
		if (pipeline == null) {
			pipeline = this.device.createRenderPipeline({
				layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.device.createBindGroupLayout({ entries: [
					{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
				] })] }),
				vertex: { module: this.vertex },
				fragment: { module: this.device.createShaderModule({ code: `
@group(0) @binding(0) var source: texture_2d<f32>;
@fragment fn fs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
	return textureLoad(source, vec2i(pixel.xy), 0);
}` }), targets: [{ format: destinationFormat }] },
				primitive: { topology: 'triangle-list' },
			});
			this.pipelines.set(destinationFormat, pipeline);
		}
		const texture = this.device.createTexture({ size: [source.width, source.height], format: destinationFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
		try {
			const group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: source.createView() }] });
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(3);
			pass.end();
			return { texture, metadata, bytes };
		} catch (error) {
			texture.destroy();
			throw error;
		}
	}

	/** GPU完了・世代確認後の画像だけを公開する。先行フレームの登録による容量変化は再確認する。 */
	commit(frameIndex: number, frame: TimelinePreviewCachedFrame<Metadata>) {
		this.remove(frameIndex);
		this.trim(frame.bytes);
		this.frames.set(frameIndex, frame);
		this.estimatedBytes += frame.bytes;
		this.changed = true;
	}

	private remove(frameIndex: number) {
		const frame = this.frames.get(frameIndex);
		if (frame == null) return;
		frame.texture.destroy();
		this.estimatedBytes -= frame.bytes;
		this.frames.delete(frameIndex);
		this.changed = true;
	}

	private trim(additionalBytes: number) {
		while (this.estimatedBytes + additionalBytes > this.maxBytes && this.frames.size > 0) this.remove(this.frames.keys().next().value!);
	}

	clear() {
		for (const frame of this.frames.values()) frame.texture.destroy();
		this.frames.clear();
		this.estimatedBytes = 0;
		this.changed = true;
	}

	snapshot() {
		const frameRanges: TimelinePreviewFrameRange[] = [];
		for (const index of [...this.frames.keys()].sort((a, b) => a - b)) {
			const previous = frameRanges.at(-1);
			if (previous != null && previous.endFrame === index) previous.endFrame++;
			else frameRanges.push({ startFrame: index, endFrame: index + 1 });
		}
		return { frameRanges, estimatedBytes: this.estimatedBytes, maxBytes: this.maxBytes };
	}

	dispose() { this.clear(); this.pipelines.clear(); }
}
