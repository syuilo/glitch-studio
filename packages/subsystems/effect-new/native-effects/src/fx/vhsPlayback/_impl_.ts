import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputBindings, generateShaderInputs, inputUvScale } from '@gs/shared/gpu/shader-input.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import commonCode, { uniforms as commonCodeUniforms } from './common.shader.ts?shader';
import { createVhsFilterCoefficients, createVhsTapeSurfaceMapping, createVhsTransport, VHS_SIGNAL, VHS_TAPE } from './signal.ts';
import { createVhsHeadSpacingFilters } from './head-spacing.ts';
import recordCode from './record.wgsl?raw';
import surfaceCode from './tape-surface.wgsl?raw';
import playbackCode from './playback.wgsl?raw';
import outputCode from './output.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import type { FixedShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputValues } from '@gs/shared/gpu/shader-input.ts';
import type definition from './_def_.ts';

const imageSchema = { input: 'color' } as const;
const surfaceSchema = { tapeDamage: 'scalar', headSeparation: 'scalar', tapeDisplacement: 'vector' } as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const fragmentSource = commonCode.replaceAll('var<storage, read_write>', 'var<storage, read>');

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, defaultVertexShaderModule, resolution, inputs: parameterInputs, outputTextures } = context;
		const params = bindParameterValues(parameterInputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const uniformValues = createShaderBuffer(commonCodeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const buffers = new Map<number, GPUBuffer>();
		const disposeBuffers = () => {
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
			createBuffer(12, rfCount * 16);
			const spacing = createVhsHeadSpacingFilters();
			device.queue.writeBuffer(createBuffer(13, spacing.byteLength), 0, spacing);
		} catch (error) {
			disposeBuffers();
			throw error;
		}
		const captureStage = createStage([1]);
		const surfaceStage = createStage([10, 12]);
		const outputStage = createStage([8, 9, 12], true);

		function createImageVariant(inputs: ShaderInputValues<typeof imageSchema>) {
			const generated = generateShaderInputs(imageSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const capture = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [captureStage.layout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: generated.code + '\n' + commonCode + '\n' + recordCode }), entryPoint: 'capture' },
				});
				const output = device.createRenderPipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [outputStage.layout, bindings.layout] }),
					vertex: { module: defaultVertexShaderModule },
					fragment: { module: device.createShaderModule({ code: generated.code + '\n' + fragmentSource + '\n' + outputCode }), entryPoint: 'fs', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
					primitive: { topology: 'triangle-list' },
				});
				return { capture, output, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		function createSurfaceVariant(inputs: ShaderInputValues<typeof surfaceSchema>) {
			const generated = generateShaderInputs(surfaceSchema, inputs, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const pipeline = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [surfaceStage.layout, bindings.layout] }),
					compute: { module: device.createShaderModule({ code: generated.code + '\n' + commonCode + '\n' + surfaceCode }), entryPoint: 'resolveTapeSurface' },
				});
				return { pipeline, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		}

		type ComputeStage = { pipeline: GPUComputePipeline; group: GPUBindGroup; dispatch: [number, number, number] };
		let recordingStages: ComputeStage[];
		let playbackStages: ComputeStage[];
		try {
			const recordingModule = device.createShaderModule({ code: 'fn read_input(position: vec2f) -> vec4f { return vec4f(0.0); }\n' + commonCode + '\n' + recordCode });
			const playbackModule = device.createShaderModule({ code: commonCode + '\n' + playbackCode });
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
				['readTape', [5, 6, 12, 13], [32, VHS_SIGNAL.lineCount, 1]],
				['separateSignals', [6, 7, 11], [32, VHS_SIGNAL.lineCount, 1]],
				['compensateDropouts', [7], [32, 1, 1]],
				['demodulate', [7, 8, 10], [VHS_SIGNAL.lineCount, 1, 1]],
				['recoverTiming', [8, 9], [1, 1, 1]],
			]);
		} catch (error) {
			disposeBuffers();
			throw error;
		}
		const imageInputs = { input: params.input };
		const surfaceInputs = { tapeDamage: params.tapeDamage, headSeparation: params.headSeparation, tapeDisplacement: params.tapeDisplacement };
		const imageVariant = createImageVariant(imageInputs);
		const surfaceVariant = createSurfaceVariant(surfaceInputs);
		const getImageGroup = imageVariant.bindings.bindFixedInputs(imageInputs, resolution);
		const surfaceReference = { width: resolution.width, height: VHS_TAPE.recordedWidthMeters };
		const getSurfaceGroup = surfaceVariant.bindings.bindFixedInputs(surfaceInputs, resolution, { referenceResolutions: {
			tapeDamage: surfaceReference, headSeparation: surfaceReference, tapeDisplacement: surfaceReference,
		} });
		return {
			cacheKey: 0,
			render({ commandEncoder }) {
				if (!Object.values(params).every(value => typeof value !== 'number' || Number.isFinite(value))
					|| !params.backgroundColor.every(Number.isFinite)) throw new Error('VHS Playback: parameters must be finite.');
				let samplingGrid = [1, 1];
				if (params.input.kind === 'texture') {
					const scale = inputUvScale(params.input.resolution, resolution, params.input.fitMode);
					samplingGrid = [
						clamp(Math.ceil(params.input.resolution.width * scale[0] / (VHS_SIGNAL.basebandSamples * VHS_SIGNAL.activeDuration / VHS_SIGNAL.linePeriod)), 1, 8),
						clamp(Math.ceil(params.input.resolution.height * scale[1] / VHS_SIGNAL.activeLineCount), 1, 8),
					];
				}
				const transport = createVhsTransport({
					time: params.time, seed: params.seed,
					trackingOffset: clamp(params.trackingOffset, -1.5, 1.5), trackAlignmentError: clamp(params.trackAlignmentError, -3, 3),
					timeBaseError: clamp(params.timeBaseError, 0, 4), scanTimingDrift: clamp(params.scanTimingDrift, -8, 8),
					headContact: clamp(params.headContact, 0, 1), headSwitching: params.headSwitching, headTimingDifference: clamp(params.headTimingDifference, -8, 8),
				});
				const surfaceLength = clamp(params.tapeSurfaceLength, 0.05, 60);
				surfaceReference.width = VHS_TAPE.speedMetersPerSecond * surfaceLength;
				const mappingFor = (input: FixedShaderInput) => {
					const scaleX = input.kind === 'texture' ? inputUvScale(input.resolution, surfaceReference, input.fitMode)[0] : 1;
					const wrapPeriod = input.kind === 'uniform' || input.wrapMode === 'repeat' ? 1 : input.wrapMode === 'repeatMirrored' ? 2 : null;
					return createVhsTapeSurfaceMapping({ fieldTime: transport.fieldTime, lengthSeconds: surfaceLength, offsetSeconds: params.tapeSurfaceOffset, horizontalInputScale: scaleX, wrapPeriod });
				};
				device.queue.writeBuffer(buffers.get(10)!, 0, transport.lineStates);
				uniformValues.set({
					samplingGrid, opaque: Number(params.alphaMode === 'opaque'), compensate: Number(params.dropoutCompensation),
					dropoutProbability: clamp(params.dropoutRate, 0, 5000) * VHS_SIGNAL.linePeriod,
					dropoutSamples: clamp(params.dropoutDuration, 0.1, 30) * 1e-6 / VHS_SIGNAL.linePeriod * VHS_SIGNAL.rfSamples,
					dropoutDepth: clamp(params.dropoutDepth, 0, 1), noiseAmplitude: 10 ** (clamp(params.rfNoiseFloor, -100, -12) / 20),
					chromaCorrection: clamp(params.chromaCorrection, 0, 1), timeBaseCorrection: clamp(params.timeBaseCorrection, 0, 1),
					seed: transport.seed, fieldSeed: transport.fieldSeed, tapeCell: transport.tapeCell, tapeFraction: transport.tapeFraction,
					background: params.backgroundColor,
					tapeDamageMapping: mappingFor(params.tapeDamage), headSeparationMapping: mappingFor(params.headSeparation), tapeDisplacementMapping: mappingFor(params.tapeDisplacement),
					displacementScaleMeters: Math.max(surfaceReference.width, surfaceReference.height),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const capture = commandEncoder.beginComputePass();
				capture.setPipeline(imageVariant.capture);
				capture.setBindGroup(0, captureStage.group);
				capture.setBindGroup(1, getImageGroup());
				capture.dispatchWorkgroups(8, VHS_SIGNAL.lineCount);
				capture.end();
				const encodeStages = (stages: ComputeStage[]) => {
					for (const stage of stages) {
						const pass = commandEncoder.beginComputePass();
						pass.setPipeline(stage.pipeline);
						pass.setBindGroup(0, stage.group);
						pass.dispatchWorkgroups(...stage.dispatch);
						pass.end();
					}
				};
				encodeStages(recordingStages);
				const surface = commandEncoder.beginComputePass();
				surface.setPipeline(surfaceVariant.pipeline);
				surface.setBindGroup(0, surfaceStage.group);
				surface.setBindGroup(1, getSurfaceGroup());
				surface.dispatchWorkgroups(32, VHS_SIGNAL.lineCount);
				surface.end();
				encodeStages(playbackStages);
				const output = beginOutputPass(commandEncoder, outputView);
				output.setPipeline(imageVariant.output);
				output.setBindGroup(0, outputStage.group);
				output.setBindGroup(1, getImageGroup());
				output.draw(3);
				output.end();
			},
			dispose() { imageVariant.bindings.dispose(); surfaceVariant.bindings.dispose(); disposeBuffers(); },
		};
	},
};

export default implementation;
