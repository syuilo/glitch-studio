import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const simulationLongSide = 480;
const stepSeconds = 1 / 60;
const maximumSteps = 64;

export default implementEffect<typeof definition>({
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		scalar: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, enable32bitDataTextures }, resolution }) => {
		const scale = simulationLongSide / Math.max(resolution.width, resolution.height);
		const simulationSize = { width: Math.max(2, Math.round(resolution.width * scale)), height: Math.max(2, Math.round(resolution.height * scale)) };
		const lowSize = { width: Math.max(1, Math.floor(simulationSize.width / 2)), height: Math.max(1, Math.floor(simulationSize.height / 2)) };
		// このUNORM8は色の作業精度ではなく、飽和と最小減衰を含む状態更新の仕様。
		// 公開するベクトル・スカラーは通常の16/32bitデータ形式へ復号する。
		const createState = (size: { width: number; height: number }) => device.createTexture({
			size, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		const states = [createState(simulationSize), createState(simulationSize)];
		const lowState = createState(lowSize);
		const blurState = createState(lowSize);
		const stateViews = states.map(texture => texture.createView());
		const lowView = lowState.createView();
		const blurView = blurState.createView();
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformSize = uniformValues.arrayBuffer.byteLength;
		const uniformStride = Math.ceil(uniformSize / device.limits.minUniformBufferOffsetAlignment) * device.limits.minUniformBufferOffsetAlignment;
		const uniformData = new Uint8Array(uniformStride * (maximumSteps + 1));
		const uniformBuffer = device.createBuffer({ size: uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uniformSize } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		const createGroup = (state: GPUTextureView, low: GPUTextureView) => device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer, size: uniformSize } },
			{ binding: 1, resource: state }, { binding: 2, resource: low }, { binding: 3, resource: sampler },
		] });
		const stateGroups = stateViews.map(view => createGroup(view, lowView));
		// 各パスの書き込み先を同じbind groupから参照しない。
		const downsampleGroups = stateViews.map(view => createGroup(view, view));
		const horizontalGroup = createGroup(lowView, lowView);
		const verticalGroup = createGroup(blurView, blurView);
		const shaderModule = device.createShaderModule({ code });
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
		const createPipeline = (entryPoint: string, targets: GPUColorTargetState[] = [{ format: 'rgba8unorm' }]) => device.createRenderPipeline({
			layout: pipelineLayout, vertex: { module: defaultVertexShaderModule },
			fragment: { module: shaderModule, entryPoint, targets }, primitive: { topology: 'triangle-list' },
		});
		const advancePipeline = createPipeline('advance');
		const downsamplePipeline = createPipeline('downsample');
		const horizontalPipeline = createPipeline('blurHorizontal');
		const verticalPipeline = createPipeline('blurVertical');
		const outputPipeline = createPipeline('output', [
			{ format: enable32bitDataTextures ? 'rg32float' : 'rg16float' },
			{ format: enable32bitDataTextures ? 'r32float' : 'r16float' },
		]);
		let currentState = 0;
		let previousInput: readonly [number, number] | null = null;
		let previousStep: readonly [number, number] = [0, 0];
		let previousRadius = 0;
		let momentum: readonly [number, number] = [0, 0];
		let pendingSeconds = 0;
		let wasEmitting = false;
		let initialized = false;
		return {
			render: ctx => {
				const params = ctx.params;
				const numericParameters = [
					...params.position, params.strength, params.radius, params.fullRadiusSpeed, params.inputHalfLife,
					params.velocityHalfLife, params.halfLife, params.fastHalfLife, params.advectionStrength,
					params.smoothing, params.noiseStrength, params.noiseSize, params.seed,
				];
				if (!numericParameters.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))) || !Number.isFinite(ctx.timeDelta) || !Number.isFinite(Math.fround(ctx.timeDelta))) {
					throw new Error('Flow Trail requires finite parameters and frame duration.');
				}
				const position = params.position;
				const reset = !initialized || params.reset || ctx.timeDelta < 0;
				if (reset) {
					for (const view of [...stateViews, lowView, blurView]) {
						ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments: [{
							view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.5, g: 0.5, b: 0, a: 0 },
						}] }).end();
					}
					previousInput = null;
					pendingSeconds = 0;
					wasEmitting = false;
					initialized = true;
				}
				const canEmit = params.emit && params.strength > 0 && !(position[0] <= -999 && position[1] <= -999);
				const seconds = reset ? 0 : Math.max(0, ctx.timeDelta / 1000);
				const repositionedWhileStopped = seconds === 0 && previousInput != null && (position[0] !== previousInput[0] || position[1] !== previousInput[1]);
				if (previousInput == null || !canEmit || !wasEmitting || repositionedWhileStopped) {
					// 初回・再開・入力なし・停止中の位置変更を、前回の線分へ接続しない。
					previousInput = [position[0], position[1]];
					previousStep = [position[0], position[1]];
					previousRadius = 0;
					momentum = [0, 0];
				}
				const from = previousInput;
				const elapsed = pendingSeconds + seconds;
				const tickCount = Math.floor((elapsed + 1e-9) / stepSeconds);
				const stepCount = Math.min(maximumSteps, tickCount);
				const tailTicks = Math.max(0, tickCount - stepCount);
				const referenceScale = getSizeReferenceLength(params.sizeReference, resolution) / Math.max(resolution.width, resolution.height);
				const decay = (halfLife: number, ticks = 1) => halfLife > 0 ? Math.exp(-Math.LN2 * stepSeconds * ticks * 1000 / halfLife) : 0;
				const seed = Math.trunc(params.seed) >>> 0;
				const writeUniforms = (index: number, drawFrom: readonly number[], drawTo: readonly number[], injection: readonly number[], ticks = 1, transport = true) => {
					uniformValues.set({
						halfExtent: getSpatialHalfExtent(resolution), drawFrom, drawTo, injection,
						dissipation: [decay(params.velocityHalfLife, ticks), decay(params.halfLife, ticks), decay(params.fastHalfLife, ticks)],
						minimumChange: 0.004 * ticks, advectionSeconds: transport ? stepSeconds : 0,
						advectionStrength: Math.max(0, params.advectionStrength),
						noiseStrength: Math.max(0, params.noiseStrength), noiseSize: Math.max(0.0001, params.noiseSize * referenceScale),
						smoothing: Math.max(0, params.smoothing * referenceScale),
						seedOffset: seed === 0 ? [0, 0] : [(seed * 0.754877666) % 1024, (seed * 0.569840296) % 1024],
					});
					uniformData.set(new Uint8Array(uniformValues.arrayBuffer), index * uniformStride);
				};
				for (let step = 0; step < stepCount; step++) {
					const ratio = seconds > 0 ? Math.min(1, (stepSeconds * (step + 1) - pendingSeconds) / seconds) : 1;
					const next: readonly [number, number] = [from[0] + (position[0] - from[0]) * ratio, from[1] + (position[1] - from[1]) * ratio];
					const movement = [next[0] - previousStep[0], next[1] - previousStep[1]];
					const speed = Math.hypot(...movement) / stepSeconds;
					const radius = canEmit ? Math.max(0, params.radius) * referenceScale * Math.min(1, speed / Math.max(0.000001, params.fullRadiusSpeed)) : 0;
					// 元のu_vel = u_vel * .8 + deltaPixels * dt * .8。位置だけ共通単位へ換算する。
					momentum = canEmit ? [
						momentum[0] * decay(params.inputHalfLife) + movement[0] * simulationLongSide * stepSeconds * 0.8 * params.strength,
						momentum[1] * decay(params.inputHalfLife) + movement[1] * simulationLongSide * stepSeconds * 0.8 * params.strength,
					] : [0, 0];
					const strength = canEmit ? params.strength : 0;
					writeUniforms(step, [...previousStep, previousRadius, strength], [...next, radius, strength], momentum);
					previousStep = next;
					previousRadius = radius;
				}
				if (tailTicks > 0) {
					// 大きな停止時間でGPUへ無制限にパスを積まない。残りは減衰だけを進め、
					// 未観測の長いポインター移動を注入しない。通常の60Hz比較には入らない経路。
					writeUniforms(stepCount, [...position, 0, 0], [...position, 0, 0], [0, 0], tailTicks, false);
					previousStep = [position[0], position[1]];
					previousRadius = 0;
					momentum = [0, 0];
				}
				const passCount = stepCount + (tailTicks > 0 ? 1 : 0);
				if (passCount === 0) writeUniforms(0, [...position, 0, 0], [...position, 0, 0], [0, 0]);
				device.queue.writeBuffer(uniformBuffer, 0, uniformData, 0, Math.max(1, passCount) * uniformStride);
				const draw = (pipeline: GPURenderPipeline, group: GPUBindGroup, view: GPUTextureView, step: number) => {
					const pass = ctx.createPassEncoderFor(ctx.commandEncoder, view);
					pass.setPipeline(pipeline); pass.setBindGroup(0, group, [step * uniformStride]); pass.draw(3); pass.end();
				};
				for (let step = 0; step < passCount; step++) {
					const nextState = 1 - currentState;
					draw(advancePipeline, stateGroups[currentState], stateViews[nextState], step);
					currentState = nextState;
					draw(downsamplePipeline, downsampleGroups[currentState], lowView, step);
					draw(horizontalPipeline, horizontalGroup, blurView, step);
					draw(verticalPipeline, verticalGroup, lowView, step);
				}
				const outputPass = ctx.createPassEncoder(ctx.commandEncoder, { colorAttachments:
					[ctx.outputDataMap.output.textureView, ctx.outputDataMap.scalar.textureView].map(view => ({ view, loadOp: 'clear', storeOp: 'store' })),
				});
				outputPass.setPipeline(outputPipeline);
				outputPass.setBindGroup(0, stateGroups[currentState], [0]);
				outputPass.draw(3);
				outputPass.end();
				pendingSeconds = Math.max(0, elapsed - tickCount * stepSeconds);
				previousInput = [position[0], position[1]];
				wasEmitting = canEmit;
			},
			dispose: () => {
				uniformBuffer.destroy();
				for (const texture of [...states, lowState, blurState]) texture.destroy();
			},
		};
	},
});
