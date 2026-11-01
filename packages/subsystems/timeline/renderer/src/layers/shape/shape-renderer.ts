import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { timelineTextureSize } from '../../timeline-image.ts';
import shapeDistanceCode from '@gs/shared/gpu/shape-distance.wgsl?raw';
import shapeRendererCode from './shape-renderer.wgsl?raw';
import { getShapeStrokeEndpoint } from './shape-stroke-progress.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { EvaluatedShape } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';

const code = shapeDistanceCode + '\n' + shapeRendererCode;

/** 評価済みの形状だけを受け取り、配置先やBindingを知らずに透明背景へ描画する。 */
export function createShapeRenderer(options: { device: GPUDevice; vertex: GPUShaderModule; resolution: Resolution; format: IntermediateTextureFormat }) {
	const { device, resolution, format } = options;
	const uniforms = makeStructuredView(makeShaderDataDefinitions(code).uniforms.uniforms);
	const buffer = device.createBuffer({ size: uniforms.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const pipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: { module: options.vertex, entryPoint: 'vs' },
		fragment: { module: device.createShaderModule({ code }), entryPoint: 'fs', targets: [{ format }] },
		primitive: { topology: 'triangle-list' },
	});
	const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
	let texture: GPUTexture | null = null;
	let result: TimelineImage;
	let previousKey: string | null = null;
	return {
		render(encoder: GPUCommandEncoder, values: EvaluatedShape): TimelineImage {
			// 解像度はインスタンス内で固定なので、換算前の公開値だけで同じ描画を判定できる。
			// 背景は含めず、呼び出し側の合成を毎回行うことで下層の動画も更新する。
			const key = JSON.stringify(values);
			if (key === previousKey) return result;
			// 既存の輪郭・部分描画モデルは内部の高さ単位で計算し、公開値だけを境界で換算する。
			const distanceToHeight = Math.max(resolution.width, resolution.height) / resolution.height;
			const shape: EvaluatedShape = { ...values, position: spatialToNormalizedCoordinates(values.position, resolution),
				size: [values.size[0] * distanceToHeight, values.size[1] * distanceToHeight],
				strokeWidth: values.strokeWidth * distanceToHeight,
				...(values.type === 'rectangle' ? { cornerRadius: values.cornerRadius * distanceToHeight } : {}),
			};
			const inside = shape.strokeAlignment === 'inside' ? shape.strokeWidth : shape.strokeAlignment === 'center' ? shape.strokeWidth / 2 : 0;
			// 回転前の外周を囲う矩形を回転する。Scene外の位置でも同じ画素密度で描く。
			const outside = shape.strokeWidth - inside + 2 / resolution.height;
			const rotation = shape.rotation * (2 * Math.PI);
			const c = Math.abs(Math.cos(rotation));
			const s = Math.abs(Math.sin(rotation));
			const extentX = (c * (shape.size[0] / 2 + outside) + s * (shape.size[1] / 2 + outside)) * 2 * resolution.height / resolution.width;
			const extentY = (s * (shape.size[0] / 2 + outside) + c * (shape.size[1] / 2 + outside)) * 2;
			const bounds = {
				left: shape.position[0] - extentX,
				right: shape.position[0] + extentX,
				bottom: shape.position[1] - extentY,
				top: shape.position[1] + extentY,
			};
			const size = timelineTextureSize(bounds, resolution, device.limits.maxTextureDimension2D);
			if (!texture || texture.width !== size.width || texture.height !== size.height) {
				texture?.destroy();
				texture = device.createTexture({ size, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
			}
			const partialStroke = shape.strokeProgress > 0 && shape.strokeProgress < 1;
			const start = getShapeStrokeEndpoint(shape, partialStroke ? shape.strokeStart % 1 : 0);
			const end = getShapeStrokeEndpoint(shape, partialStroke ? (shape.strokeStart + shape.strokeProgress) % 1 : 0);
			const startAngle = Math.atan2(start.point[0], start.point[1]);
			const sweepAngle = (Math.atan2(end.point[0], end.point[1]) - startAngle + 2 * Math.PI) % (2 * Math.PI);
			uniforms.set({
				// 配置位置はregion.boundsだけが所有する。GPUでは中心原点の局所座標を使い、
				// 大きい配置位置を足してから引く際の桁落ちと、画素ごとの座標補正を避ける。
				localHalfExtent: [extentX * resolution.width / resolution.height * 0.5, extentY * 0.5],
				halfSize: shape.size.map(value => value / 2),
				fillColor: shape.fillColor,
				strokeColor: shape.strokeColor,
				rotation,
				cornerRadius: shape.type === 'rectangle' ? shape.cornerRadius : 0,
				strokeInside: inside,
				strokeOutside: shape.strokeWidth - inside,
				strokeProgress: shape.strokeProgress,
				strokeStartPoint: start.point,
				strokeStartTangent: start.tangent,
				strokeEndPoint: end.point,
				strokeEndTangent: end.tangent,
				strokeStartAngle: startAngle,
				strokeSweepAngle: sweepAngle,
				pixelSize: extentY / size.height,
				shapeType: shape.type === 'ellipse' ? 0 : 1,
			});
			device.queue.writeBuffer(buffer, 0, uniforms.arrayBuffer);
			const pass = encoder.beginRenderPass({
				colorAttachments: [{
					view: texture.createView(),
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: [0, 0, 0, 0],
				}],
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(3);
			pass.end();
			previousKey = key;
			return result = { kind: 'texture', texture, region: { bounds, frameSize: resolution } };
		},
		dispose() { texture?.destroy(); buffer.destroy(); },
	};
}
