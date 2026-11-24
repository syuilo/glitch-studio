import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSizeReferenceLength, type SizeReference } from '@gs/shared/size-reference.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { EffectInitContext, EffectRenderContext } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import code, { uniforms as codeUniforms } from './trail-history.wgsl?shader';

type TrailBrush = { radius: number; sizeReference: SizeReference; strength: number; halfLife: number };

/** サンプル間の移動を積算し、使用ポートごとに2枚を交替して履歴を公開する。 */
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
	const uniformValues = createShaderBuffer(codeUniforms.uniforms);
	const uniformBuffer = device.createBuffer({
		size: uniformValues.arrayBuffer.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	const halfExtent = getSpatialHalfExtent(resolution);
	const longSide = Math.max(resolution.width, resolution.height);
	const frames = [0, 1].map(index => {
		const previous = ports.map(port => port?.views[1 - index]);
		// 未使用側の読み取り口には使用側のviewを借用し、ダミーの履歴を確保しない。
		const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
			{ binding: 1, resource: { buffer: uniformBuffer } },
			{ binding: 2, resource: previous[0] ?? previous[1]! },
			{ binding: 3, resource: previous[1] ?? previous[0]! },
		] });
		const pass: GPURenderPassDescriptor = { colorAttachments: ports.map(port => port == null ? null : {
			view: port.views[index], loadOp: 'clear', storeOp: 'store',
		}) };
		return { group, pass };
	});
	let next = 0;
	let clearPrevious = false;
	let previousPosition: readonly [number, number] | null = null;
	return {
		render({ commandEncoder: encoder, timeDelta }: EffectRenderContext, position: readonly [number, number] | null, brush: TrailBrush) {
			const start = previousPosition ?? position ?? [0, 0];
			const end = position ?? start;
			const deltaX = end[0] - start[0];
			const deltaY = end[1] - start[1];
			const movementLength = Math.hypot(deltaX, deltaY);
			uniformValues.set({
				halfExtent,
				elapsedHalfLives: Math.max(0, timeDelta) / Math.max(1, brush.halfLife),
				radius: brush.radius * getSizeReferenceLength(brush.sizeReference, resolution) / longSide,
				strength: brush.strength,
				segmentStart: start,
				movementDirection: movementLength === 0 ? [0, 0] : [deltaX / movementLength, deltaY / movementLength],
				movementLength,
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
			// 入力の配列をそのまま保持すると、呼び出し側の更新で移動元も変わる。
			previousPosition = position == null ? null : [position[0], position[1]];
		},
		resetRenderHistory() {
			clearPrevious = true;
			previousPosition = null;
		},
		dispose() {
			for (const port of ports) port?.textures[1].destroy();
			uniformBuffer.destroy();
		},
	};
}
