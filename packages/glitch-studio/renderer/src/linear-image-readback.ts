import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';

/** 表示変換前のHALF RGBA画像を所有する。読み戻したブロックは上から順に並ぶ。 */
export class LinearImageReadback {
	private readonly texture: GPUTexture;
	private readonly pipeline: GPURenderPipeline;
	private disposed = false;

	public constructor(private readonly device: GPUDevice, public readonly width: number, public readonly height: number) {
		this.texture = device.createTexture({ label: 'Linear image export', size: [width, height], format: 'rgba16float',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		this.pipeline = device.createRenderPipeline({ layout: 'auto',
			vertex: { module: device.createShaderModule({ code: vertexCode }), entryPoint: 'vs' },
			fragment: { module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn main(@builtin(position) position: vec4f) -> @location(0) vec4f {
	return textureLoad(image, vec2i(position.xy), 0);
}` }), entryPoint: 'main', targets: [{ format: 'rgba16float' }] },
		});
	}

	public capture(source: GPUTexture, encoder: GPUCommandEncoder): void {
		if (this.disposed) throw new Error('Linear image is closed.');
		if (source.width !== this.width || source.height !== this.height) throw new Error('Linear image dimensions do not match the scene.');
		// 出力は借用画像でCOPY_SRCを持つとは限らない。表示用の色変換・補間・背景合成を
		// 経由せず、各画素を1対1で所有テクスチャへ確定してから読み戻す。
		const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.texture.createView(),
			loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: source.createView() }] }));
		pass.draw(3);
		pass.end();
	}

	public async *readBlocks(rowsPerBlock: number, signal: AbortSignal): AsyncGenerator<Uint16Array> {
		if (!Number.isInteger(rowsPerBlock) || rowsPerBlock < 1) throw new Error('Invalid image block height.');
		const bytesPerRow = Math.ceil(this.width * 8 / 256) * 256;
		// 全画像分のreadback bufferは8Kで既定のmaxBufferSizeを超える。
		// GPU待機を1行ごとに発生させず、圧縮ブロックの整数倍をまとめて取得する。
		const batchRows = Math.floor(Math.min(256, this.device.limits.maxBufferSize / bytesPerRow) / rowsPerBlock) * rowsPerBlock;
		if (batchRows < rowsPerBlock) throw new Error('GPU readback buffer limit is too small.');
		const buffer = this.device.createBuffer({ label: 'Linear image readback', size: bytesPerRow * Math.min(batchRows, this.height),
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			for (let start = 0; start < this.height; start += batchRows) {
				signal.throwIfAborted();
				if (this.disposed) throw new Error('Linear image is closed.');
				const rows = Math.min(batchRows, this.height - start);
				const encoder = this.device.createCommandEncoder();
				encoder.copyTextureToBuffer({ texture: this.texture, origin: [0, start] }, { buffer, bytesPerRow }, [this.width, rows]);
				this.device.queue.submit([encoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const pixels = new Uint16Array(this.width * rows * 4);
				try {
					const padded = new Uint16Array(buffer.getMappedRange());
					for (let row = 0; row < rows; row++) pixels.set(padded.subarray(row * bytesPerRow / 2, row * bytesPerRow / 2 + this.width * 4), row * this.width * 4);
				} finally { buffer.unmap(); }
				for (let row = 0; row < rows; row += rowsPerBlock) {
					signal.throwIfAborted();
					yield pixels.subarray(row * this.width * 4, Math.min(row + rowsPerBlock, rows) * this.width * 4);
				}
			}
		} finally { buffer.destroy(); }
	}

	public dispose(): void { this.disposed = true; this.texture.destroy(); }
}
