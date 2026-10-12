import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import blendCode from '@gs/shared/color-blend.wgsl?raw';
import { TIMELINE_FRAME, TIMELINE_IDENTITY, intersectTimelineBounds, invertTimelineAffine, multiplyTimelineAffine, projectTimelineMatrix, timelineGeometryMatrix, transformTimelineBounds, unionTimelineBounds } from '@gs/subsystems_timeline_shared/spatial.ts';
import code from './timeline-compositor.wgsl?raw';
import { timelineImageBounds, timelineImageFrame, timelineTextureSize } from './timeline-image.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { TimelineCompositingSettings } from './timeline-compositing-parameters.ts';
import type { TimelineAffine, TimelineBounds, TimelineRenderSpace } from '@gs/subsystems_timeline_shared/spatial.ts';
import type { TimelineImage } from './timeline-image.ts';

export type TimelineCompositingObserver = (source: TimelineImage, settings: TimelineCompositingSettings, space?: TimelineRenderSpace) => void;
const boundsUniform = (bounds: TimelineBounds) => [(bounds.left + bounds.right) / 2, (bounds.bottom + bounds.top) / 2, (bounds.right - bounds.left) / 2, (bounds.top - bounds.bottom) / 2];
const rows = (matrix: TimelineAffine) => ({ x: [matrix[0], matrix[2], matrix[4], 0], y: [matrix[1], matrix[3], matrix[5], 0] });

export function getTimelinePlacement(source: TimelineImage, resolution: { width: number; height: number }, settings: TimelineCompositingSettings, space?: TimelineRenderSpace) {
	const local = timelineGeometryMatrix({ sourceSize: timelineImageFrame(source, resolution), sceneSize: resolution, transform: settings });
	return settings.placement === 'screen' ? local : projectTimelineMatrix(multiplyTimelineAffine(space?.parent ?? TIMELINE_IDENTITY, local), (space?.depth ?? 0) + settings.depth, space?.camera);
}

// 合成先の画素範囲は可変でも、fit・origin・位置の基準となるScene寸法は変えない。
export function createTimelineCompositor(options: {
	device: GPUDevice; vertex: GPUShaderModule; resolution: { width: number; height: number }; format: IntermediateTextureFormat;
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
		schema: { background: 'color', source: 'color' }, targets: [{ format: options.format }], internalLayouts: [layout], sampling: 'level0' });
	let texture: GPUTexture | undefined;
	return {
		render(encoder: GPUCommandEncoder, background: TimelineImage, source: TimelineImage, settings: TimelineCompositingSettings,
			space: TimelineRenderSpace = { parent: TIMELINE_IDENTITY, depth: 0, viewport: TIMELINE_FRAME }, projected = false, fixedBounds?: TimelineBounds): TimelineImage {
			options.onCompositing?.(source, settings, space);
			if (settings.opacity === 0 || settings.blendMode === 10) return background;
			const placement = getTimelinePlacement(source, resolution, settings, space);
			// カメラの背後はレイヤーが存在しない扱い。Replaceでも背景を消さない。
			if (!projected && !placement) return background;
			const matrix = projected ? TIMELINE_IDENTITY : placement;
			const inverse = matrix && invertTimelineAffine(matrix);
			const clipInverse = placement && invertTimelineAffine(placement);
			const sourceBounds = timelineImageBounds(source);
			let foregroundBounds = matrix && inverse ? transformTimelineBounds(sourceBounds, matrix) : null;
			if (settings.clipToFrame) foregroundBounds = foregroundBounds && placement && clipInverse ? intersectTimelineBounds(foregroundBounds, transformTimelineBounds(TIMELINE_FRAME, placement)) : null;
			const backgroundBounds = timelineImageBounds(background);
			let outputBounds = foregroundBounds ? unionTimelineBounds(backgroundBounds, foregroundBounds) : backgroundBounds;
			if (space?.viewport) outputBounds = intersectTimelineBounds(outputBounds, space.viewport) ?? space.viewport;
			outputBounds = fixedBounds ?? outputBounds;
			// 無変形のReplaceは素材を借用する。高解像度の動画・画像をここで縮小せず、
			// 次のEffectが素材解像度を選べる既存の動作と余分なパスの省略を維持する。
			if (!fixedBounds && settings.blendMode === 19 && settings.opacity === 1 && !settings.clipToFrame
				&& matrix && matrix.every((value, index) => Math.abs(value - TIMELINE_IDENTITY[index]) < 1e-12)
				&& Object.keys(sourceBounds).every(key => sourceBounds[key as keyof TimelineBounds] === outputBounds[key as keyof TimelineBounds])) {
				// 画素を借用しても配置後の基準枠はSceneへ変わる。素材寸法のまま返すと、
				// Stretch済みの画像を親グループが再度Fitし、子の配置を失ってしまう。
				return { ...source, region: { bounds: outputBounds, frameSize: resolution } };
			}
			const size = timelineTextureSize(outputBounds, resolution, device.limits.maxTextureDimension2D);
			if (!texture || texture.width !== size.width || texture.height !== size.height) {
				texture?.destroy();
				texture = device.createTexture({ size, format: options.format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			}
			const inverseRows = rows(inverse ?? TIMELINE_IDENTITY);
			const clipRows = rows(clipInverse ?? TIMELINE_IDENTITY);
			uniforms.set({
				inverseX: inverseRows.x, inverseY: inverseRows.y, clipX: clipRows.x, clipY: clipRows.y,
				sourceBounds: boundsUniform(sourceBounds), backgroundBounds: boundsUniform(backgroundBounds), outputBounds: boundsUniform(outputBounds),
				opacity: settings.opacity, blendMode: settings.blendMode, sourceVisible: Number(foregroundBounds != null), clipToFrame: Number(settings.clipToFrame) });
			device.queue.writeBuffer(buffer, 0, uniforms.arrayBuffer);
			const variant = pipelines.update({
				// 背景は合成先へ配置済み。座標範囲への写像はWGSL側で行うため、
				// 拡張された描画先の物理寸法でFitし直すと、静止した背景までクロップされる。
				background: toShaderInput(background, { fitMode: 'stretch', wrapMode: 'transparent', filterMode: 'linear' }),
				source: toShaderInput(source, { fitMode: 'stretch', wrapMode: 'transparent', filterMode: 'linear' }),
			}, size);
			const descriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] };
			const pass = options.beginPass?.(encoder, descriptor) ?? encoder.beginRenderPass(descriptor);
			pass.setPipeline(variant.pipeline);
			pass.setBindGroup(0, group);
			pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
			pass.draw(6);
			pass.end();
			return { kind: 'texture', texture, region: { bounds: outputBounds, frameSize: resolution } };
		},
		dispose() { texture?.destroy(); buffer.destroy(); pipelines.dispose(); },
	};
}
