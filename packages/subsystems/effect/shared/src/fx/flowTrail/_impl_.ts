import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import { type default as definition, referenceSimulationRate } from './_def_.ts';

const simulationLongSide = 480;
const referenceStepSeconds = 1 / referenceSimulationRate;
const maximumSteps = 64;
const stateFormat: GPUTextureFormat = 'rgba16float';

function decayLoss(halfLifeMs: number, durationSeconds: number): number {
	return halfLifeMs > 0 ? -Math.expm1(-Math.LN2 * durationSeconds * 1000 / halfLifeMs) : 1;
}

// 一定の入力に対して、60Hzでの1回分の加算と同じ平衡値へ収束するように換算する。
// 経過時間だけで加算を比例配分すると、同時に減衰する量がステップ幅に応じて変わる。
function sourceScale(halfLifeMs: number, stepSeconds: number): number {
	return decayLoss(halfLifeMs, stepSeconds) / decayLoss(halfLifeMs, referenceStepSeconds);
}

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
		// 高いレートで微小な注入や減衰がUNORM8の丸めで消えないよう、符号付きの流れを直接保持する。
		// 値の飽和範囲と軌跡の最小変化量はシェーダーで扱う。
		const createState = (size: { width: number; height: number }) => device.createTexture({
			size, format: stateFormat, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
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
		const createPipeline = (entryPoint: string, targets: GPUColorTargetState[] = [{ format: stateFormat }]) => device.createRenderPipeline({
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
				const stepSeconds = 1 / params.simulationRate;
				if (params.simulationRate <= 0 || !Number.isFinite(Math.fround(params.simulationRate)) || !Number.isFinite(Math.fround(stepSeconds))) {
					throw new Error('Flow Trail Simulation Rate must be a positive, finite rate in Hz.');
				}
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
							view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 },
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
				const tickCount = seconds > 0 ? Math.floor(elapsed * params.simulationRate + 1e-9) : 0;
				const stepCount = Math.min(maximumSteps, tickCount);
				const tailSeconds = (tickCount - stepCount) * stepSeconds;
				const referenceScale = getSizeReferenceLength(params.sizeReference, resolution) / Math.max(resolution.width, resolution.height);
				const momentumRetention = 1 - decayLoss(params.inputHalfLife, stepSeconds);
				const momentumGain = simulationLongSide * referenceStepSeconds ** 2 * 0.8 * sourceScale(params.inputHalfLife, stepSeconds) * params.strength;
				const flowInjectionScale = sourceScale(params.velocityHalfLife, stepSeconds);
				const trailInjectionScale = [sourceScale(params.halfLife, stepSeconds), sourceScale(params.fastHalfLife, stepSeconds)];
				const seed = Math.trunc(params.seed) >>> 0;
				const writeUniforms = (index: number, drawFrom: readonly number[], drawTo: readonly number[], injection: readonly number[], durationSeconds = stepSeconds, transport = true) => {
					uniformValues.set({
						halfExtent: getSpatialHalfExtent(resolution), drawFrom, drawTo, trailInjectionScale,
						flowInjection: [injection[0] * flowInjectionScale, injection[1] * flowInjectionScale],
						decayLoss: [decayLoss(params.velocityHalfLife, durationSeconds), decayLoss(params.halfLife, durationSeconds), decayLoss(params.fastHalfLife, durationSeconds)],
						minimumChange: 0.004 * (durationSeconds / referenceStepSeconds), advectionSeconds: transport ? durationSeconds : 0,
						advectionStrength: Math.max(0, params.advectionStrength),
						noiseStrength: Math.max(0, params.noiseStrength), noiseSize: Math.max(0.0001, params.noiseSize * referenceScale),
						smoothing: Math.max(0, params.smoothing * referenceScale),
						seedOffset: seed === 0 ? [0, 0] : [(seed * 0.754877666) % 1024, (seed * 0.569840296) % 1024],
					});
					uniformData.set(new Uint8Array(uniformValues.arrayBuffer), index * uniformStride);
				};
				for (let step = 0; step < stepCount; step++) {
					// レートを上げて新しい刻み幅が繰り越し時間より短くなった場合、過去側の位置には直近の入力を使う。
					const ratio = Math.max(0, Math.min(1, (stepSeconds * (step + 1) - pendingSeconds) / seconds));
					const next: readonly [number, number] = [from[0] + (position[0] - from[0]) * ratio, from[1] + (position[1] - from[1]) * ratio];
					const movement = [next[0] - previousStep[0], next[1] - previousStep[1]];
					const strokeLength = Math.hypot(...movement);
					const speed = strokeLength / stepSeconds;
					const radius = canEmit ? Math.max(0, params.radius) * referenceScale * Math.min(1, speed / Math.max(0.000001, params.fullRadiusSpeed)) : 0;
					momentum = canEmit ? [
						momentum[0] * momentumRetention + (movement[0] / stepSeconds) * momentumGain,
						momentum[1] * momentumRetention + (movement[1] / stepSeconds) * momentumGain,
					] : [0, 0];
					// 同じ速度でも刻み幅が短いほど描画する線分が短くなる。半径 r のブラシの
					// smoothstep で重みづけした面積はおよそ r × 線分長 + 0.3πr² なので、
					// 60Hzと面積の比を取って、移動中に描き足される軌跡と流れの量を揃える。
					const capCoverageLength = 0.3 * Math.PI * (previousRadius + radius) / 2;
					const strokeScale = strokeLength > 0 ? (speed * referenceStepSeconds + capCoverageLength) / (strokeLength + capCoverageLength) : 1;
					const strength = canEmit ? params.strength * strokeScale : 0;
					writeUniforms(step, [...previousStep, previousRadius, strength], [...next, radius, strength], [momentum[0] * strokeScale, momentum[1] * strokeScale]);
					previousStep = next;
					previousRadius = radius;
				}
				if (tailSeconds > 0) {
					// 大きな停止時間でGPUへ無制限にパスを積まない。残りは減衰だけを進め、
					// 未観測の長いポインター移動を注入しない。
					writeUniforms(stepCount, [...position, 0, 0], [...position, 0, 0], [0, 0], tailSeconds, false);
					previousStep = [position[0], position[1]];
					previousRadius = 0;
					momentum = [0, 0];
				}
				const passCount = stepCount + (tailSeconds > 0 ? 1 : 0);
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
