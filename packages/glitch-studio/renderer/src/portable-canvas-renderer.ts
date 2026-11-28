import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import colorSpaceCode from '@gs/shared/gpu/color-space.wgsl?raw';
import outputCode from './canvas-output.wgsl?raw';
import fragmentCode from './portable-canvas-fragment.wgsl?raw';
import { createCanvasOutputConfigurator, createGpuPreviewCanvasOutputSettings } from './canvas-output.ts';

/** 埋め込み用の表示境界。エディタの露出・解析・警告表示を持たず、色のencode規約だけを共有する。 */
export class PortableCanvasRenderer {
	private readonly context: GPUCanvasContext;
	private readonly pipeline: GPURenderPipeline;
	private readonly sampler: GPUSampler;

	constructor(private readonly device: GPUDevice, private readonly canvas: OffscreenCanvas) {
		const context = canvas.getContext('webgpu');
		if (context == null) throw new Error('WebGPU canvas is unavailable');
		this.context = context;
		const output = createGpuPreviewCanvasOutputSettings();
		createCanvasOutputConfigurator(device, context, output)('premultiplied');
		this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		this.pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: device.createShaderModule({ code: vertexCode }) },
			fragment: {
				module: device.createShaderModule({ code: `${colorSpaceCode}\n${outputCode}\n${fragmentCode}` }),
				entryPoint: 'fs', constants: { canvasOutputWideGamut: 1 }, targets: [{ format: output.format }],
			},
		});
	}

	public render(texture: GPUTexture | null, encoder: GPUCommandEncoder, aspectRatio: number) {
		const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
		if (texture != null) {
			// 固定寸法のノードも意味を変えない。異なる比率の出力は透明余白でcontainする。
			const width = Math.min(this.canvas.width, this.canvas.height * aspectRatio);
			const height = width / aspectRatio;
			pass.setViewport((this.canvas.width - width) / 2, (this.canvas.height - height) / 2, width, height, 0, 1);
			pass.setPipeline(this.pipeline);
			pass.setBindGroup(0, this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
				{ binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler },
			] }));
			pass.draw(3);
		}
		pass.end();
	}

	public destroy() { this.context.unconfigure(); }
}
