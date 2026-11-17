import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputBindings, generateShaderInputs, inputUvScale, shaderInputVariantKey } from '@gs/shared/gpu/shader-input.ts';
import { implementEffect } from '../../effect-implementation.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.shader.ts?shader';
import { createVhsFilterCoefficients, createVhsTapeDamageMapping, createVhsTransport, VHS_SIGNAL, VHS_TAPE } from './signal.ts';
import recordCode from './record.wgsl?raw';
import playbackCode from './playback.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type { ShaderInputValues } from '@gs/shared/gpu/shader-input.ts';
import type definition from './_def_.ts';

const inputSchema = { input: 'color', tapeDamage: 'scalar' } as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const computeSource = commonCode;
const fragmentSource = computeSource.replaceAll('var<storage, read_write>', 'var<storage, read>');

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution, format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule }, resolution }) => {
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const buffers = new Map<number, GPUBuffer>();
		const variants = new Map<string, ReturnType<typeof createVariant>>();
		const dispose = () => {
			for (const variant of variants.values()) variant.bindings.dispose();
			for (const buffer of buffers.values()) buffer.destroy();
			uniformBuffer.destroy();
		};
		const createBuffer = (binding: number, size: number) => {
			if (size > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)) throw new Error('VHS Playback: signal buffer exceeds GPU resource limits.');
			const buffer = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
			buffers.set(binding, buffer);
			return buffer;
		};
		const createStage = (bindings: number[], fragment = false) => {
			const visibility = fragment ? GPUShaderStage.FRAGMENT : GPUShaderStage.COMPUTE;
			// ステージごとに使うバッファだけを公開し、標準のstorage buffer数の上限に収める。
			const layout = device.createBindGroupLayout({ entries: [
				{ binding: 0, visibility, buffer: { type: 'uniform' } },
				...bindings.map(binding => ({ binding, visibility, buffer: { type: fragment ? 'read-only-storage' as const : 'storage' as const } })),
			] });
			const group = device.createBindGroup({ layout, entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				...bindings.map(binding => ({ binding, resource: { buffer: buffers.get(binding)! } })),
			] });
			return { layout, group };
		};
		const basebandCount = VHS_SIGNAL.basebandSamples * VHS_SIGNAL.lineCount;
		const rfCount = VHS_SIGNAL.rfSamples * VHS_SIGNAL.lineCount;
		try {
			createBuffer(1, basebandCount * 16);
			createBuffer(2, basebandCount * 16);
			createBuffer(3, rfCount * 4);
			createBuffer(4, VHS_SIGNAL.lineCount * 4);
			createBuffer(5, rfCount * 4);
			createBuffer(6, rfCount * 4);
			createBuffer(7, rfCount * 16);
			createBuffer(8, basebandCount * 16);
			createBuffer(9, VHS_SIGNAL.lineCount * 16);
			createBuffer(10, VHS_SIGNAL.lineCount * VHS_SIGNAL.lineStateFloats * Float32Array.BYTES_PER_ELEMENT);
			const coefficients = createVhsFilterCoefficients();
			device.queue.writeBuffer(createBuffer(11, coefficients.byteLength), 0, coefficients);
		} catch (error) {
			dispose();
			throw error;
		}
		const captureStage = createStage([1]);
		const readTapeStage = createStage([5, 6, 10]);
		const outputStage = createStage([8, 9, 10], true);

		function createVariant(inputs: ShaderInputValues<typeof inputSchema>) {
			const generated = generateShaderInputs(inputSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const capture = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [captureStage.layout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: generated.code + '\n' + computeSource + '\n' + recordCode }), entryPoint: 'capture' },
				});
				const readTape = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [readTapeStage.layout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: generated.code + '\n' + computeSource + '\n' + playbackCode }), entryPoint: 'readTape' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputStage.layout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: generated.code + '\n' + fragmentSource + '\n' + outputCode }), entryPoint: 'fs', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
					primitive: { topology: 'triangle-list' },
				});
				return { capture, readTape, output, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		type ComputeStage = { pipeline: GPUComputePipeline; group: GPUBindGroup; dispatch: [number, number, number] };
		let recordingStages: ComputeStage[];
		let playbackStages: ComputeStage[];
		try {
			// 入力を読むcapture/readTapeは構成ごとに作る。他のentry pointのモジュールでも
			// 未使用関数が参照する宣言が必要なので、ダミーの入力関数を補う。
			const dummyInput = 'fn read_input(position: vec2f) -> vec4f { return vec4f(0.0); }\n';
			const recordingModule = device.createShaderModule({ code: dummyInput + computeSource + '\n' + recordCode });
			const playbackModule = device.createShaderModule({ code: 'fn read_tapeDamage(position: vec2f) -> f32 { return 0.0; }\n' + computeSource + '\n' + playbackCode });
			const createStages = (module: GPUShaderModule, specifications: [string, number[], [number, number, number]][]): ComputeStage[] => specifications.map(([entryPoint, bindingIndices, dispatch]) => {
				const stage = createStage(bindingIndices);
				return { pipeline: device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [stage.layout] }), compute: { module, entryPoint } }), group: stage.group, dispatch };
			});
			recordingStages = createStages(recordingModule, [
				['prepareRecording', [1, 2], [8, VHS_SIGNAL.lineCount, 1]],
				['integratePhase', [2, 3, 4], [VHS_SIGNAL.lineCount, 1, 1]],
				['integrateLines', [4], [1, 1, 1]],
				['synthesize', [2, 3, 4, 5, 10], [32, VHS_SIGNAL.lineCount, 1]],
			]);
			playbackStages = createStages(playbackModule, [
				['separateSignals', [6, 7, 11], [32, VHS_SIGNAL.lineCount, 1]],
				['compensateDropouts', [7], [32, 1, 1]],
				['demodulate', [7, 8, 10], [VHS_SIGNAL.lineCount, 1, 1]],
				['recoverTiming', [8, 9], [1, 1, 1]],
			]);
		} catch (error) {
			dispose();
			throw error;
		}
		return {
			render: ctx => {
				const params = ctx.params;
				if (!Object.entries(params).every(([name, value]) => name === 'input' || typeof value !== 'number' || Number.isFinite(value))
					|| !params.backgroundColor.every(Number.isFinite)) throw new Error('VHS Playback: parameters must be finite.');
				let samplingGrid = [1, 1];
				if (params.input.kind === 'texture') {
					const scale = inputUvScale(params.input.texture, resolution, params.input.fitMode);
					samplingGrid = [
						clamp(Math.ceil(params.input.texture.width * scale[0] / (VHS_SIGNAL.basebandSamples * VHS_SIGNAL.activeDuration / VHS_SIGNAL.linePeriod)), 1, 8),
						clamp(Math.ceil(params.input.texture.height * scale[1] / VHS_SIGNAL.activeLineCount), 1, 8),
					];
				}
				const transport = createVhsTransport({
					time: params.time, seed: params.seed,
					trackingOffset: clamp(params.trackingOffset, -1.5, 1.5),
					trackAlignmentError: clamp(params.trackAlignmentError, -3, 3),
					timeBaseError: clamp(params.timeBaseError, 0, 4), tapeDeformation: clamp(params.tapeDeformation, -8, 8),
					headContact: clamp(params.headContact, 0, 1), headSwitching: params.headSwitching,
					headTimingDifference: clamp(params.headTimingDifference, -8, 8),
				});
				const tapeDamageLength = clamp(params.tapeDamageLength, 0.05, 60);
				const tapeDamageReference = { width: VHS_TAPE.speedMetersPerSecond * tapeDamageLength, height: VHS_TAPE.recordedWidthMeters };
				const tapeDamageInput = params.tapeDamage;
				const damageScaleX = tapeDamageInput.kind === 'texture' ? inputUvScale(tapeDamageInput.texture, tapeDamageReference, tapeDamageInput.fitMode)[0] : 1;
				const damageWrapPeriod = tapeDamageInput.kind === 'uniform' || tapeDamageInput.wrapMode === 'repeat' ? 1 : tapeDamageInput.wrapMode === 'repeatMirrored' ? 2 : null;
				device.queue.writeBuffer(buffers.get(10)!, 0, transport.lineStates);
				uniformValues.set({
					samplingGrid, opaque: Number(params.alphaMode === 'opaque'), compensate: Number(params.dropoutCompensation),
					spacingLoss: clamp(params.headSpacingLoss, 0, 1),
					dropoutProbability: clamp(params.dropoutRate, 0, 5000) * VHS_SIGNAL.linePeriod,
					dropoutSamples: clamp(params.dropoutDuration, 0.1, 30) * 1e-6 / VHS_SIGNAL.linePeriod * VHS_SIGNAL.rfSamples,
					dropoutDepth: clamp(params.dropoutDepth, 0, 1), noiseAmplitude: 10 ** (clamp(params.rfNoiseFloor, -100, -12) / 20),
					chromaCorrection: clamp(params.chromaCorrection, 0, 1), timeBaseCorrection: clamp(params.timeBaseCorrection, 0, 1),
					seed: transport.seed, fieldSeed: transport.fieldSeed, tapeCell: transport.tapeCell, tapeFraction: transport.tapeFraction,
					background: params.backgroundColor,
					tapeDamageMapping: createVhsTapeDamageMapping({ fieldTime: transport.fieldTime, lengthSeconds: tapeDamageLength, offsetSeconds: params.tapeDamageOffset, horizontalInputScale: damageScaleX, wrapPeriod: damageWrapPeriod }),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const inputs = { input: params.input, tapeDamage: tapeDamageInput };
				const key = shaderInputVariantKey(inputSchema, inputs);
				let variant = variants.get(key);
				if (variant == null) {
					variant = createVariant(inputs);
					variants.set(key, variant);
				}
				// 映像は出力の縦横比、傷は物理的なテープ範囲の縦横比でFitする。
				// これにより出力の寸法・縦横比を変えても同じ媒体上の傷を参照する。
				const inputGroup = variant.bindings.update(inputs, ctx.outputDataMap.output.texture, { tapeDamage: tapeDamageReference });
				const capture = ctx.createComputePassEncoder(ctx.commandEncoder);
				capture.setPipeline(variant.capture);
				capture.setBindGroup(0, captureStage.group);
				capture.setBindGroup(1, inputGroup);
				capture.dispatchWorkgroups(8, VHS_SIGNAL.lineCount);
				capture.end();
				const encodeStages = (stages: ComputeStage[]) => {
					for (const stage of stages) {
						const pass = ctx.createComputePassEncoder(ctx.commandEncoder);
						pass.setPipeline(stage.pipeline);
						pass.setBindGroup(0, stage.group);
						pass.dispatchWorkgroups(...stage.dispatch);
						pass.end();
					}
				};
				encodeStages(recordingStages);
				const readTape = ctx.createComputePassEncoder(ctx.commandEncoder);
				readTape.setPipeline(variant.readTape);
				readTape.setBindGroup(0, readTapeStage.group);
				readTape.setBindGroup(1, inputGroup);
				readTape.dispatchWorkgroups(32, VHS_SIGNAL.lineCount);
				readTape.end();
				encodeStages(playbackStages);
				const output = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				output.setPipeline(variant.output);
				output.setBindGroup(0, outputStage.group);
				output.setBindGroup(1, inputGroup);
				output.draw(3);
				output.end();
			},
			dispose,
		};
	},
});
