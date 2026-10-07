import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import blendCode from '@gs/shared/color-blend.wgsl?raw';
import code from './timeline-compositor.wgsl?raw';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { TimelineCompositingSettings } from './timeline-compositing-parameters.ts';
import { getTimelineFittedExtent } from '@gs/subsystems_timeline_shared/layer-transform.ts';

export type TimelineCompositingObserver = (source: UniformOrTexture, settings: TimelineCompositingSettings) => void;

// レイヤーごとに出力を所有し、同一フレーム内で下のレイヤーの出力を上書きしない。
export function createTimelineCompositor(options: {
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: { width: number; height: number };
	format: IntermediateTextureFormat;
	beginPass?: (encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => GPURenderPassEncoder;
	onCompositing?: TimelineCompositingObserver;
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
		render(encoder: GPUCommandEncoder, background: UniformOrTexture, source: UniformOrTexture, settings: TimelineCompositingSettings): UniformOrTexture {
			options.onCompositing?.(source, settings);
			const { fitMode } = settings;
			if (settings.opacity === 0 || settings.blendMode === 10) return background;
			// 共通サンプリングのfitは画面→素材の逆写像なので、割ると素材内のoriginを
			// fit後の画面座標へ戻せる。元テクスチャ全体（透明な余白を含む）を基準にし、
			// 寸法を持たない定数には画面と同じ大きさの仮想的な素材枠を与える。
			const sourceExtent = getTimelineFittedExtent(source.kind === 'texture' ? source.texture : resolution, resolution, fitMode);
			const originInOutputSpace = settings.origin.map((value, index) => value * sourceExtent[index]);
			// 置き換えだけなら借用出力をそのまま渡し、定数もテクスチャ化しない。
			// 同じ縦横比ならfitによる余白・切り取りがなく、解像度が違っても借用出力を維持できる。
			// 異なる比率では必ず描画し、後段のcoverでcontainなどが上書きされないようにする。
			const sameAspectRatio = source.kind === 'uniform' || source.texture.width * resolution.height === source.texture.height * resolution.width;
			// アンカーポイント方式では、無回転・等倍でもpositionとoriginの差だけ移動する。
			if (sameAspectRatio && settings.blendMode === 19 && settings.opacity === 1 && settings.rotation === 0
				&& settings.position.every((value, index) => value === originInOutputSpace[index]) && settings.scale.every(value => value === 1)) return source;
			texture ??= device.createTexture({ size: resolution, format: options.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			uniforms.set({
				position: settings.position, originInOutputSpace, scale: settings.scale, rotation: settings.rotation,
				opacity: settings.opacity, blendMode: settings.blendMode,
				aspectRatio: resolution.width / resolution.height, sourceIsUniform: Number(source.kind === 'uniform'),
			});
			device.queue.writeBuffer(buffer, 0, uniforms.arrayBuffer);
			// fitは読み取り座標にだけ適用する。表示枠で先に切り取らず、元画像の細部を保持する。
			const variant = pipelines.update({
				background: toShaderInput(background, { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' }),
				source: toShaderInput(source, { fitMode, wrapMode: 'transparent', filterMode: 'linear' }),
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
