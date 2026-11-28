import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { EffectPointerStrokeSegment, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import displacementCode, { uniforms as displacementUniforms } from './displacement.wgsl?shader';
import waveCode, { structs, uniforms as waveUniforms } from './wave.wgsl?shader';
import type definition from './_def_.ts';

const GRID_LONG_SIDE = 128;
const STEP_SECONDS = 1 / 120;
const MAX_STEPS_PER_FRAME = 24;
const MAX_STROKE_SEGMENTS = 128;
const WAVE_SPEED = 0.33;
const MAX_POINTER_SPEED = 2;
const SETTLED_DAMPING = -Math.log(1e-6);

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init({ device, resolution, inputs, outputTextures, defaultVertexShaderModule }) {
		const output = outputTextures.get('output')!;
		const halfExtent = getSpatialHalfExtent(resolution);
		const spatialExtent = halfExtent.map(half => 2 * half);
		const gridSize = spatialExtent.map(extent => Math.max(1, Math.round(extent * GRID_LONG_SIDE)));
		const cellsPerUnit = gridSize.map((cells, axis) => cells === 1 ? 0 : cells / spatialExtent[axis]);
		const waveWeights = cellsPerUnit.map(density => (WAVE_SPEED * STEP_SECONDS * density) ** 2);
		const [width, height] = gridSize;
		const stepValues = createShaderBuffer(waveUniforms.step);
		const stepSize = stepValues.arrayBuffer.byteLength;
		const alignment = device.limits.minUniformBufferOffsetAlignment;
		const stepStride = Math.ceil(stepSize / alignment) * alignment;
		const waveLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: stepSize } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
		] });
		const displacementModule = device.createShaderModule({ code: displacementCode });
		const vertex = { module: defaultVertexShaderModule };
		const targets = [{ format: output.format }];
		const [propagate, gradient, displacement] = await Promise.all([
			device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [waveLayout] }), compute: {
				module: device.createShaderModule({ code: waveCode }), entryPoint: 'propagate',
			} }),
			device.createRenderPipelineAsync({ layout: 'auto', vertex, fragment: {
				module: displacementModule, entryPoint: 'gradient', targets, constants: {
					GRID_WIDTH: width, GRID_HEIGHT: height, GRADIENT_X: cellsPerUnit[0] / (2 * GRID_LONG_SIDE), GRADIENT_Y: cellsPerUnit[1] / (2 * GRID_LONG_SIDE),
				},
			} }),
			device.createRenderPipelineAsync({ layout: 'auto', vertex, fragment: { module: displacementModule, entryPoint: 'displacement', targets } }),
		]);

		const strokeValues = createShaderBuffer(structs.StrokeForcing);
		const strokeSize = strokeValues.arrayBuffer.byteLength;
		const outputValues = createShaderBuffer(displacementUniforms.outputParams);
		const encodedSteps = new Uint8Array(stepStride * MAX_STEPS_PER_FRAME);
		const encodedStrokes = new Uint8Array(strokeSize * MAX_STROKE_SEGMENTS);
		const stepBuffer = device.createBuffer({ size: encodedSteps.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const strokeBuffer = device.createBuffer({ size: encodedStrokes.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const outputBuffer = device.createBuffer({ size: outputValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const heights = [0, 1].map(() => device.createBuffer({ size: width * height * Float32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
		const slopes = device.createTexture({ size: { width, height }, format: output.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
		const slopesView = slopes.createView();
		const waveGroups = heights.map((buffer, index) => device.createBindGroup({ layout: waveLayout, entries: [
			{ binding: 0, resource: { buffer: stepBuffer, size: stepSize } },
			{ binding: 1, resource: { buffer } },
			{ binding: 2, resource: { buffer: heights[1 - index] } },
			{ binding: 3, resource: { buffer: strokeBuffer } },
		] }));
		const gradientGroups = heights.map(buffer => device.createBindGroup({ layout: gradient.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] }));
		const outputGroup = device.createBindGroup({ layout: displacement.getBindGroupLayout(0), entries: [
			{ binding: 1, resource: slopesView },
			{ binding: 2, resource: device.createSampler({ minFilter: 'linear', magFilter: 'linear' }) },
			{ binding: 3, resource: { buffer: outputBuffer } },
		] });
		const gradientPass = { colorAttachments: [{ view: slopesView, loadOp: 'clear', storeOp: 'store' }] } satisfies GPURenderPassDescriptor;
		const outputPass = { colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] } satisfies GPURenderPassDescriptor;
		const isInside = ([x, y]: readonly [number, number]) => Math.abs(x) <= halfExtent[0] && Math.abs(y) <= halfExtent[1];
		let pendingSegments: EffectPointerStrokeSegment[] = [];
		let elapsedRemainder = 0;
		let currentHeight = 0;
		let hasWaves = false;
		let idleDamping = 0;
		let lastIntensity = 0;
		let resetPending = false;

		function clearWaves(encoder: GPUCommandEncoder) {
			for (const buffer of heights) encoder.clearBuffer(buffer);
			encoder.beginRenderPass(outputPass).end();
			currentHeight = 0;
			hasWaves = false;
			idleDamping = 0;
			lastIntensity = 0;
			resetPending = false;
		}

		return {
			render({ commandEncoder, time, timeDelta, pointerStrokeSegments }) {
				if (resetPending) clearWaves(commandEncoder);
				const elapsed = Number.isFinite(timeDelta) ? Math.max(0, timeDelta) / 1000 : 0;
				const accumulated = Math.min(elapsedRemainder + elapsed, MAX_STEPS_PER_FRAME * STEP_SECONDS);
				const stepCount = Math.floor((accumulated + 1e-9) / STEP_SECONDS);
				elapsedRemainder = Math.max(0, accumulated - stepCount * STEP_SECONDS);
				if (elapsed > 0 && pointerStrokeSegments != null) {
					pendingSegments = [...pendingSegments, ...pointerStrokeSegments.filter(segment => isInside(segment.start) && isInside(segment.end))].slice(-MAX_STROKE_SEGMENTS);
				}
				const radius = Math.max(0, inputs.radius.value);
				const damping = Math.max(0, inputs.decay.value) * 0.24 * STEP_SECONDS;
				const velocityRetention = Math.exp(-damping);
				let consumedSegments = 0;
				let writtenSegments = 0;
				let writtenSteps = 0;
				for (let index = 0; index < stepCount; index++) {
					const stepTime = time - elapsedRemainder - (stepCount - 1 - index) * STEP_SECONDS;
					const segmentOffset = writtenSegments;
					// 線分の終点が届いたステップで全区間に力を加える。描画が遅れても線分を点に間引かない。
					while (consumedSegments < pendingSegments.length && pendingSegments[consumedSegments].endTime <= stepTime + 1e-9) {
						const { start, end, startTime, endTime } = pendingSegments[consumedSegments++];
						const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
						if (radius <= 0 || distance < 1e-7) continue;
						const speed = Math.min(MAX_POINTER_SPEED, distance / Math.max(0.001, endTime - startTime));
						strokeValues.set({ start, end, force: 180 * STEP_SECONDS ** 2 * speed });
						encodedStrokes.set(new Uint8Array(strokeValues.arrayBuffer), writtenSegments++ * strokeSize);
					}
					const segmentCount = writtenSegments - segmentOffset;
					if (segmentCount > 0) {
						hasWaves = true;
						idleDamping = 0;
					} else if (hasWaves) idleDamping += damping;
					if (!hasWaves) continue;
					stepValues.set({ gridSize, spatialExtent, waveWeights, velocityRetention, radius, segmentOffset, segmentCount });
					encodedSteps.set(new Uint8Array(stepValues.arrayBuffer), writtenSteps++ * stepStride);
				}
				pendingSegments.splice(0, consumedSegments);
				// 十分に減衰したら残りの高さを消す。実時間で判定すると一時停止中にも波が消えてしまう。
				if (idleDamping >= SETTLED_DAMPING) { clearWaves(commandEncoder); return; }
				if (!hasWaves) return;
				if (writtenSteps > 0) {
					if (writtenSegments > 0) device.queue.writeBuffer(strokeBuffer, 0, encodedStrokes, 0, writtenSegments * strokeSize);
					device.queue.writeBuffer(stepBuffer, 0, encodedSteps, 0, writtenSteps * stepStride);
					const pass = commandEncoder.beginComputePass();
					pass.setPipeline(propagate);
					for (let step = 0; step < writtenSteps; step++) {
						pass.setBindGroup(0, waveGroups[currentHeight], [step * stepStride]);
						pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
						currentHeight = 1 - currentHeight;
					}
					pass.end();
					const slopePass = commandEncoder.beginRenderPass(gradientPass);
					slopePass.setPipeline(gradient);
					slopePass.setBindGroup(0, gradientGroups[currentHeight]);
					slopePass.draw(3);
					slopePass.end();
				}
				const intensity = Math.max(0, inputs.intensity.value);
				if (writtenSteps === 0 && intensity === lastIntensity) return;
				lastIntensity = intensity;
				outputValues.set({ intensity: 0.1 * intensity });
				device.queue.writeBuffer(outputBuffer, 0, outputValues.arrayBuffer);
				const pass = commandEncoder.beginRenderPass(outputPass);
				pass.setPipeline(displacement);
				pass.setBindGroup(0, outputGroup);
				pass.draw(3);
				pass.end();
			},
			resetRenderHistory() {
				pendingSegments = [];
				elapsedRemainder = 0;
				resetPending = true;
			},
			dispose() {
				for (const buffer of [...heights, stepBuffer, strokeBuffer, outputBuffer]) buffer.destroy();
				slopes.destroy();
			},
		};
	},
};

export default implementation;
