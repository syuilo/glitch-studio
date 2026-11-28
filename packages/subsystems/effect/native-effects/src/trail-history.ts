import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength, type SizeReference } from '@gs/shared/size-reference.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { EffectInitContext, EffectRenderContext } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import code, { structs, uniforms as shaderUniforms } from './trail-history.wgsl?shader';

type TrailBrush = { radius: number; sizeReference: SizeReference; strength: number; halfLife: number };
type TrailSegment = {
	readonly start: readonly [number, number];
	readonly end: readonly [number, number];
	/** フレームのtimeと同じ内容時刻（秒）。 */
	readonly startTime: number;
	readonly endTime: number;
};

/** 内容時刻付きの線分を積算し、使用ポートごとに2枚を交替して履歴を公開する。 */
export function createTrailHistory({ device, defaultVertexShaderModule, resolution, outputTextures }: Pick<EffectInitContext, 'device' | 'defaultVertexShaderModule' | 'resolution' | 'outputTextures'>,
	publish: ReadonlyMap<string, (texture: GPUTexture) => void>) {
	const ports = ['output', 'scalar'].map(id => {
		const output = outputTextures.get(id);
		if (output == null) return null;
		const alternate = device.createTexture({ size: resolution, format: output.format, usage: output.usage });
		return { textures: [output, alternate], views: [output.createView(), alternate.createView()], publish: publish.get(id)! };
	});
	const shaderModule = device.createShaderModule({ code });
	const pipeline = device.createRenderPipeline({
		vertex: { module: defaultVertexShaderModule },
		fragment: {
			module: shaderModule,
			targets: ports.map(port => port == null ? null : { format: port.textures[0].format }),
		},
		primitive: { topology: 'triangle-list' },
		layout: 'auto',
	});
	const uniformValues = createShaderBuffer(shaderUniforms.uniforms);
	const uniformBuffer = device.createBuffer({
		size: uniformValues.arrayBuffer.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	const segmentValues = createShaderBuffer(structs.Segment);
	const segmentBytes = new Uint8Array(segmentValues.arrayBuffer);
	const segmentStride = segmentBytes.byteLength;
	let packedSegments = new Uint8Array(segmentStride);
	let segmentBuffer = device.createBuffer({ size: packedSegments.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	const halfExtent = getSpatialHalfExtent(resolution);
	const longSide = Math.max(resolution.width, resolution.height);
	function createFrames(segments: GPUBuffer) {
		return [0, 1].map(index => {
			const previous = ports.map(port => port?.views[1 - index]);
			// 未使用側の読み取り口には使用側のviewを借用し、ダミーの履歴を確保しない。
			const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
				{ binding: 1, resource: { buffer: uniformBuffer } },
				{ binding: 2, resource: previous[0] ?? previous[1]! },
				{ binding: 3, resource: previous[1] ?? previous[0]! },
				{ binding: 4, resource: { buffer: segments } },
			] });
			const pass: GPURenderPassDescriptor = { colorAttachments: ports.map(port => port == null ? null : {
				view: port.views[index], loadOp: 'clear', storeOp: 'store',
			}) };
			return { group, pass };
		});
	}
	let frames = createFrames(segmentBuffer);
	let next = 0;
	let clearPrevious = false;
	return {
		render({ commandEncoder: encoder, time, timeDelta }: EffectRenderContext, segments: readonly TrailSegment[], brush: TrailBrush) {
			const halfLifeMilliseconds = Math.max(1, brush.halfLife);
			const halfLivesPerSecond = 1000 / halfLifeMilliseconds;
			const requiredBytes = segments.length * segmentStride;
			if (requiredBytes > packedSegments.byteLength) {
				// 描画間に入力が集中したときに容量を増やし、以降のフレームでもバッファとbind groupを使い回す。
				const capacity = 2 ** Math.ceil(Math.log2(segments.length));
				const buffer = device.createBuffer({ size: capacity * segmentStride, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
				frames = createFrames(buffer);
				segmentBuffer.destroy();
				segmentBuffer = buffer;
				packedSegments = new Uint8Array(buffer.size);
			}
			let segmentCount = 0;
			for (const { start, end, startTime, endTime } of segments) {
				const deltaX = end[0] - start[0];
				const deltaY = end[1] - start[1];
				const length = Math.hypot(deltaX, deltaY);
				if (length === 0) continue;
				segmentValues.set({
					start,
					direction: [deltaX / length, deltaY / length],
					length,
					traversalHalfLives: Math.max(0, endTime - startTime) * halfLivesPerSecond,
					// 描画待ちの間に届いた線分も、通過中と通過後の両方の時間を減衰に含める。
					endDecay: 2 ** (-Math.max(0, time - endTime) * halfLivesPerSecond),
				});
				packedSegments.set(segmentBytes, segmentCount++ * segmentStride);
			}
			if (segmentCount > 0) device.queue.writeBuffer(segmentBuffer, 0, packedSegments, 0, segmentCount * segmentStride);
			uniformValues.set({
				halfExtent,
				elapsedHalfLives: Math.max(0, timeDelta) / halfLifeMilliseconds,
				radius: brush.radius * getSizeReferenceLength(brush.sizeReference, resolution) / longSide,
				strength: brush.strength,
				segmentCount,
			});
			device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);

			if (clearPrevious) encoder.beginRenderPass(frames[1 - next].pass).end();
			clearPrevious = false;
			const frame = frames[next];
			const pass = encoder.beginRenderPass(frame.pass);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, frame.group);
			pass.draw(3);
			pass.end();
			for (const port of ports) port?.publish(port.textures[next]);
			next = 1 - next;
		},
		resetRenderHistory() {
			clearPrevious = true;
		},
		dispose() {
			for (const port of ports) port?.textures[1].destroy();
			uniformBuffer.destroy();
			segmentBuffer.destroy();
		},
	};
}
