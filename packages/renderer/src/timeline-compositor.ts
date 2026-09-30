import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@glitch/shared/shader-input-pipeline.ts';
import blendCode from '@glitch/shared/color-blend.wgsl?raw';
import type { FitMode, IntermediateTextureFormat } from '@glitch/shared/types.ts';
import { outputShaderInput } from './node-output.ts';
import type { NodeOutput } from './node-output.ts';
import type { TimelineCompositingSettings } from './timeline-compositing-parameters.ts';
import code from './timeline-compositor.wgsl?raw';

// レイヤーごとに出力を所有し、同一フレーム内で下のレイヤーの出力を上書きしない。
export function createTimelineCompositor(options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: { width: number; height: number };
	format: IntermediateTextureFormat;
	beginPass?: (encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => GPURenderPassEncoder;
}) {
	const { device, resolution } = options;
	const uniforms = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
	const buffer = device.createBuffer({ size: uniforms.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
	const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] });
	const pipelines = createShaderInputPipeline({
		device, vertex: options.vertex, code: blendCode + code,
		schema: { background: 'color', source: 'color' }, targets: [{ format: options.format }],
		internalLayouts: [layout], sampling: 'level0',
	});
	let texture: GPUTexture | undefined;
	return {
		render(encoder: GPUCommandEncoder, background: NodeOutput, source: NodeOutput, settings: TimelineCompositingSettings, fitMode: FitMode = 'cover'): NodeOutput {
			if (settings.opacity === 0 || settings.blendMode === 10) return background;
			// 置き換えだけなら借用出力をそのまま渡し、定数もテクスチャ化しない。
			// 同じ縦横比ならfitによる余白・切り取りがなく、解像度が違っても借用出力を維持できる。
			// 異なる比率では必ず描画し、後段のcoverでcontainなどが上書きされないようにする。
			const sameAspectRatio = source.kind === 'uniform' || source.texture.width * resolution.height === source.texture.height * resolution.width;
			if (sameAspectRatio && settings.blendMode === 19 && settings.opacity === 1 && settings.rotation === 0
				&& settings.translation.every(value => value === 0) && settings.scale.every(value => value === 1)) return source;
			texture ??= device.createTexture({ size: resolution, format: options.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			uniforms.set({ ...settings, aspectRatio: resolution.width / resolution.height, sourceIsUniform: Number(source.kind === 'uniform') });
			device.queue.writeBuffer(buffer, 0, uniforms.arrayBuffer);
			// fitは読み取り座標にだけ適用する。表示枠で先に切り取らず、元画像の細部を保持する。
			const variant = pipelines.update({
				background: outputShaderInput(background, { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' }),
				source: outputShaderInput(source, { fitMode, wrapMode: 'transparent', filterMode: 'linear' }),
			}, resolution);
			const descriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] };
			const pass = options.beginPass?.(encoder, descriptor) ?? encoder.beginRenderPass(descriptor);
			pass.setPipeline(variant.pipeline);
			pass.setBindGroup(0, group);
			pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
			pass.draw(6);
			pass.end();
			return { kind: 'texture', texture };
		},
		dispose() {
			texture?.destroy();
			buffer.destroy();
			pipelines.dispose();
		},
	};
}
