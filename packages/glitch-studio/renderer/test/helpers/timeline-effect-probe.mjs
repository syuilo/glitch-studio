import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './load-shader-source.mjs';
import { gpuFixture, snapshotNativeInputs } from './manager-gpu.mjs';

const { createEffectTimelineLayer } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/layers/effect/effect-timeline-layer.ts')));

/** 実際のTimelineとGraphの境界を通り、末端のNative Effectが受け取った入力とフレームを記録する。 */
export function createTimelineEffectProbe({ paramDefs = {}, params = {}, primaryInputParameter = null, primaryAudioInputParameter = null,
	getAudioInput, prepare, render, dispose = () => {}, automationGraphs = [] } = {}) {
	globalThis.GPUTextureUsage ??= { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 };
	globalThis.GPUBufferUsage ??= { UNIFORM: 1, COPY_DST: 2 };
	globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2 };
	const { device, texture } = gpuFixture();
	const resolution = { width: 1, height: 1 };
	const definition = { kind: primaryInputParameter == null ? 'generate' : 'modify', paramDefs, primaryInputParameter, primaryAudioInputParameter,
		resolutionInputParameters: [], outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output' };
	const graph = { ...definition, outputSources: { output: { nodeId: 'probe', outputPort: 'output' } },
		nodes: [{ id: 'probe', effectSource: { type: 'nativeEffect', id: 'probe' },
			params: Object.fromEntries(Object.keys(paramDefs).map(id => [id, { inputSource: 'customNodeGraphEffectPublicParameterReference', parameterId: id }])) }] };
	const renderer = createEffectTimelineLayer({
		effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }, effectParamValues: params, effectStaticSettings: {},
		resolution: { mode: 'context', scale: 1 }, automationGraphs, compositingParamValues: {},
	}, { sceneBaseResolution: resolution, resolutionScale: 1, getAudioInput,
		definitions: { getNativeEffect: () => definition }, wgpu: { device, defaultVertexShaderModule: {}, enable32bitDataTextures: false },
		getNativeEffectImplementation: () => ({ init({ inputs }) { return {
			prepare: prepare && ((frame, signal) => prepare(frame, snapshotNativeInputs(inputs), signal)),
			render(frame) { render?.(frame, snapshotNativeInputs(inputs)); }, dispose,
		}; } }),
	});
	return { ...renderer, texture: () => ({ kind: 'texture', texture: texture() }) };
}
