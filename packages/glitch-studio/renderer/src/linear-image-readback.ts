import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { readImageBlocks } from './image-readback-blocks.ts';

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
		for await (const block of readImageBlocks(this.device, this.texture, { bytesPerPixel: 8, rowsPerBlock, signal, isDisposed: () => this.disposed })) {
			yield new Uint16Array(block.buffer, block.byteOffset, block.byteLength / 2);
		}
	}

	public dispose(): void { this.disposed = true; this.texture.destroy(); }
}
