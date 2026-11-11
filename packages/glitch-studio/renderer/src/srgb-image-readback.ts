import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import colorSpaceCode from '@gs/shared/gpu/color-space.wgsl?raw';
import { readImageBlocks } from './image-readback-blocks.ts';

/** WebP等へ渡す、未乗算の8bit sRGB RGBA画像を所有する。Canvasの表示寿命には依存しない。 */
export class SrgbImageReadback {
	private readonly texture: GPUTexture;
	private readonly pipeline: GPURenderPipeline;
	private disposed = false;

	public constructor(private readonly device: GPUDevice, public readonly width: number, public readonly height: number) {
		this.texture = device.createTexture({ label: 'sRGB image export', size: [width, height], format: 'rgba8uint',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		this.pipeline = device.createRenderPipeline({ layout: 'auto',
			vertex: { module: device.createShaderModule({ code: vertexCode }), entryPoint: 'vs' },
			fragment: { module: device.createShaderModule({ code: `${colorSpaceCode}
@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn main(@builtin(position) position: vec4f) -> @location(0) vec4u {
	let linear = textureLoad(image, vec2i(position.xy), 0);
	if (linear.a <= 0.0) { return vec4u(0u); }
	// Canvasへ乗算済み8bitを書いてから再び未乗算へ戻すと、半透明のRGBを
	// 二重に量子化する。エンコーダー用の未乗算sRGBへ直接変換し、最後に一度だけ量子化する。
	let straight = vec4f(clamp(colorLinearToSrgb(linear.rgb / linear.a), vec3f(0.0), vec3f(1.0)), clamp(linear.a, 0.0, 1.0));
	// UNORMの境界値の丸めをバックエンドへ委ねると、alpha=0.5が127/128に分かれ得る。
	// 整数の描画先へ確定済みのbyteを書き、同じ値をCPUへそのまま読み戻す。
	return vec4u(floor(straight * 255.0 + 0.5));
}` }), entryPoint: 'main', targets: [{ format: 'rgba8uint' }] },
		});
	}

	public capture(source: GPUTexture, encoder: GPUCommandEncoder): void {
		if (this.disposed) throw new Error('sRGB image is closed.');
		if (source.width !== this.width || source.height !== this.height) throw new Error('sRGB image dimensions do not match the scene.');
		const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.texture.createView(),
			loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: source.createView() }] }));
		pass.draw(3);
		pass.end();
	}

	public async *readBlocks(rowsPerBlock: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
		yield* readImageBlocks(this.device, this.texture, { bytesPerPixel: 4, rowsPerBlock, signal, isDisposed: () => this.disposed });
	}

	public dispose(): void { this.disposed = true; this.texture.destroy(); }
}
