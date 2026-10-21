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
import type { TimelineLayerContext, TimelineLayerEvaluation } from './timeline-renderer.ts';

export type TimelineCompositingObserver = (source: TimelineImage, settings: TimelineCompositingSettings, space?: TimelineRenderSpace) => void;
const boundsUniform = (bounds: TimelineBounds) => [(bounds.left + bounds.right) / 2, (bounds.bottom + bounds.top) / 2, (bounds.right - bounds.left) / 2, (bounds.top - bounds.bottom) / 2];
const rows = (matrix: TimelineAffine) => ({ x: [matrix[0], matrix[2], matrix[4], 0], y: [matrix[1], matrix[3], matrix[5], 0] });

export function getTimelinePlacement(source: TimelineImage, resolution: { width: number; height: number }, settings: TimelineCompositingSettings, space?: TimelineRenderSpace) {
	const transformsRegion = settings.transformTarget === 'region';
	const local = timelineGeometryMatrix({
		sourceSize: transformsRegion ? resolution : timelineImageFrame(source, resolution), sceneSize: resolution,
		transform: transformsRegion ? { ...settings, fitMode: 'stretch' } : settings,
	});
	return settings.coordinateSpace === 'screen' ? multiplyTimelineAffine(space?.screenParent ?? TIMELINE_IDENTITY, local) : projectTimelineMatrix(multiplyTimelineAffine(space?.parent ?? TIMELINE_IDENTITY, local), (space?.depth ?? 0) + settings.depth, resolution, space?.camera);
}

// 合成先の画素範囲は可変でも、fit・origin・位置の基準となるScene寸法は変えない。
export function createTimelineCompositor(options: {
	device: GPUDevice; vertex: GPUShaderModule; resolution: { width: number; height: number }; format: IntermediateTextureFormat;
	beginPass?: (encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => GPURenderPassEncoder;
	onCompositing?: TimelineCompositingObserver | null;
}) {
	const { device, resolution } = options;
	const uniforms = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
	const buffer = device.createBuffer({ size: uniforms.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
	const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] });
	const pipelines = createShaderInputPipeline({
		device, vertex: options.vertex, code: blendCode + code,
		schema: { background: 'color', source: 'color', layerMask: 'color' }, targets: [{ format: options.format }], internalLayouts: [layout], sampling: 'level0' });
	let texture: GPUTexture | null = null;
	let renderedCompositor: ReturnType<typeof createTimelineCompositor> | null = null;
	return {
		/** 素材のGPU処理は呼び出し側がsubmitし、合成は依存評価が確定してから実行する。 */
		evaluate(context: TimelineLayerContext<TimelineImage>, source: TimelineImage,
			settings: TimelineCompositingSettings, projected = false): TimelineLayerEvaluation<TimelineImage> {
			const submit = async (compositor: ReturnType<typeof createTimelineCompositor>, background: TimelineImage, values: TimelineCompositingSettings, signal: AbortSignal) => {
				// 素材だけへの参照ではマスクを要求しない。単独描画・通常合成の直前に解決し、
				// 取得先自身の時計・描画空間で生成された結果を共有セッションから読む。
				const layerMaskImage = values.layerMask == null ? null : await context.getLayerOutput(values.layerMask.sourceLayerId, 'rendered');
				signal.throwIfAborted();
				const commandEncoder = device.createCommandEncoder();
				try { return compositor.render(commandEncoder, background, source, values, context.renderSpace, projected, undefined, layerMaskImage); } finally { device.queue.submit([commandEncoder.finish()]); }
			};
			return {
				source, gpuTime: 0,
				rendered: signal => {
					// マスク元など、通常合成を省くレイヤーも変形ハンドルの素材寸法を通知する。
					options.onCompositing?.(source, settings, context.renderSpace);
					// 通常合成と別の出力を保持し、一方を参照中にもう一方で上書きしない。
					renderedCompositor ??= createTimelineCompositor({ ...options, onCompositing: null });
					return submit(renderedCompositor, { kind: 'uniform', value: [0, 0, 0, 0] }, { ...settings, blendMode: 0, mask: null }, signal);
				},
				composite: (background, signal) => submit(this, background, settings, signal),
			};
		},
		render(encoder: GPUCommandEncoder, background: TimelineImage, source: TimelineImage, settings: TimelineCompositingSettings,
			space: TimelineRenderSpace = { parent: TIMELINE_IDENTITY, depth: 0, viewport: TIMELINE_FRAME }, projected = false, fixedBounds?: TimelineBounds, layerMaskImage: TimelineImage | null = null): TimelineImage {
			options.onCompositing?.(source, settings, space);
			if (settings.opacity === 0 || (settings.mask == null && settings.blendMode === 10)) return background;
			const placement = getTimelinePlacement(source, resolution, settings, space);
			const transformsRegion = settings.transformTarget === 'region';
			// カメラの背後はレイヤーが存在しない扱い。Replaceでも背景を消さない。
			if (!projected && !placement) return background;
			const matrix = projected ? TIMELINE_IDENTITY : placement;
			const inverse = matrix && invertTimelineAffine(matrix);
			const clipInverse = placement && invertTimelineAffine(placement);
			const sourceBounds = timelineImageBounds(source);
			// 範囲モードの画像は合成先に固定されている。変形した枠と実際の画像範囲の
			// 交差だけを描き、移動・拡大で存在しない画素まで描画範囲へ加えない。
			let foregroundBounds: TimelineBounds | null = null;
			if (matrix != null && inverse != null) {
				foregroundBounds = transformsRegion
					? intersectTimelineBounds(sourceBounds, transformTimelineBounds(TIMELINE_FRAME, matrix))
					: transformTimelineBounds(sourceBounds, matrix);
			}
			if (!transformsRegion && settings.clipToFrame) foregroundBounds = foregroundBounds && placement && clipInverse ? intersectTimelineBounds(foregroundBounds, transformTimelineBounds(TIMELINE_FRAME, placement)) : null;
			// 範囲が潰れた場合はReplaceや通常マスクでも下層を保持する。
			if (transformsRegion && foregroundBounds == null) return background;
			const backgroundBounds = timelineImageBounds(background);
			// マスクは下層の被覆率だけを変える。素材の領域を合成範囲へ足すと、
			// 大きなマスクを動かすだけで親Groupのfit・originや画素密度まで変わってしまう。
			let outputBounds = settings.mask == null && foregroundBounds ? unionTimelineBounds(backgroundBounds, foregroundBounds) : backgroundBounds;
			if (space?.viewport) outputBounds = intersectTimelineBounds(outputBounds, space.viewport) ?? space.viewport;
			outputBounds = fixedBounds ?? outputBounds;
			// 無変形のReplaceは素材を借用する。高解像度の動画・画像をここで縮小せず、
			// 次のEffectが素材解像度を選べる既存の動作と余分なパスの省略を維持する。
			if (!transformsRegion && settings.mask == null && settings.layerMask == null && !fixedBounds && settings.blendMode === 19 && settings.opacity === 1 && !settings.clipToFrame
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
			const maskImage: TimelineImage = layerMaskImage ?? { kind: 'uniform', value: [0, 0, 0, 0] };
			uniforms.set({
				inverseX: inverseRows.x, inverseY: inverseRows.y, clipX: clipRows.x, clipY: clipRows.y,
				sourceBounds: boundsUniform(sourceBounds), backgroundBounds: boundsUniform(backgroundBounds), outputBounds: boundsUniform(outputBounds),
				opacity: settings.opacity, blendMode: settings.blendMode, sourceVisible: Number(foregroundBounds != null), clipToFrame: Number(settings.clipToFrame),
				transformTarget: Number(transformsRegion),
				maskChannel: settings.mask == null ? 0 : settings.mask.channel === 'alpha' ? 1 : 2, maskInverted: Number(settings.mask?.inverted === true),
				layerMaskBounds: boundsUniform(timelineImageBounds(maskImage)),
				layerMaskChannel: settings.layerMask == null ? 0 : settings.layerMask.channel === 'alpha' ? 1 : 2,
				layerMaskInverted: Number(settings.layerMask?.inverted === true) });
			device.queue.writeBuffer(buffer, 0, uniforms.arrayBuffer);
			const variant = pipelines.update({
				// 背景は合成先へ配置済み。座標範囲への写像はWGSL側で行うため、
				// 拡張された描画先の物理寸法でFitし直すと、静止した背景までクロップされる。
				background: toShaderInput(background, { fitMode: 'stretch', wrapMode: 'transparent', filterMode: 'linear' }),
				source: toShaderInput(source, { fitMode: 'stretch', wrapMode: 'transparent', filterMode: 'linear' }),
				layerMask: toShaderInput(maskImage, { fitMode: 'stretch', wrapMode: 'transparent', filterMode: 'linear' }),
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
		dispose() { renderedCompositor?.dispose(); texture?.destroy(); buffer.destroy(); pipelines.dispose(); },
	};
}
