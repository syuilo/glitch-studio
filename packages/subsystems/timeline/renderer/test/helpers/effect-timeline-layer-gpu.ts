import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import type { CustomNodeGraphEffect, CustomShaderEffect, EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { createEffectTimelineLayer } from '../../src/layers/effect/effect-timeline-layer.ts';
import type { TimelineImage } from '../../src/timeline-image.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from '../../src/timeline-renderer.ts';

const customShaderEffect: CustomShaderEffect = {
	paramDefs: {
		base: { dataType: { kind: 'color' }, canNode: true, ui: { label: 'Base', control: {} }, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		clock: { dataType: { kind: 'scalar' }, canNode: true, ui: { label: 'Clock', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: { secondary: { dataType: { kind: 'scalar' } }, image: { dataType: { kind: 'color' } } },
	primaryInputId: 'base', primaryAudioInputId: null, primaryOutputId: 'image',
	inputNames: { base: 'background', clock: 'scene_clock' }, outputNames: { secondary: 'data', image: 'picture' },
	code: `fn main(p: vec2f) -> Output {
		let input = read_background(p);
		return Output(-7, vec4f(input.r, read_scene_clock(p), get_time(), input.a));
	}`,
};
const customNodeGraphEffect: CustomNodeGraphEffect = {
	paramDefs: customShaderEffect.paramDefs, outputDefs: customShaderEffect.outputDefs,
	primaryInputId: 'base', primaryAudioInputId: null, primaryOutputId: 'image',
	nodes: [{ id: 'shader', effect: { type: 'customShaderEffectReference', id: 'clock' }, params: {
		base: { type: 'publicParameter', parameterId: 'base' }, clock: { type: 'publicParameter', parameterId: 'clock' },
	} }],
	outputs: { image: { type: 'nodeOutput', nodeId: 'shader', outputId: 'image' }, secondary: { type: 'nodeOutput', nodeId: 'shader', outputId: 'secondary' } },
};

function layer(effect: EffectSource, effectParamValues: TimelineEffectLayer['effectParamValues']): TimelineEffectLayer {
	return {
		id: 'effect', name: 'Effect', color: null, layerType: 'effect', effect, effectParamValues,
		resolution: { mode: 'auto', scale: 1 }, coordinateSpace: 'screen', mask: null, layerMask: null,
		isDisabled: false, isSolo: false, isIncludedInComposite: true, forceDisableMotionBlur: false,
		clips: [], automationGraphs: [],
		compositingParamValues: Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, parameter]) =>
			[key, parameter.defaultValue])) as TimelineEffectLayer['compositingParamValues'],
	};
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const catalog = new EffectCatalog({
		customShaderEffects: new Map([['clock', customShaderEffect]]),
		customNodeGraphEffects: new Map([['clock', customNodeGraphEffect]]),
	});
	const options = { device, vertex: device.createShaderModule({ code: vertexCode }), resolution: { width: 4, height: 4 }, resolutionScale: 1 };
	const signal = new AbortController().signal;
	const context: TimelineLayerContext<TimelineImage> = {
		isExport: true, sceneTimeMs: 3500, contentTimeMs: 1250, clipElapsedTimeMs: 250, clipDurationMs: 4000,
		contentEndTimeMs: 5000, timeDelta: 33, getInput: async () => { throw new Error('Unexpected lower layer request'); },
		getLayerOutput: async () => { throw new Error('Unexpected layer reference'); },
	};
	const readback = device.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	async function readPixel(source: TimelineImage | null | undefined) {
		if (source?.kind !== 'texture') throw new Error('Expected Effect source texture');
		const encoder = device.createCommandEncoder();
		encoder.copyTextureToBuffer({ texture: source.texture }, { buffer: readback }, [1, 1]);
		device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const pixel = Array.from(new Float16Array(readback.getMappedRange()));
		readback.unmap();
		return pixel;
	}
	const sources: EffectSource[] = [
		{ type: 'customShaderEffectReference', id: 'clock' },
		{ type: 'customNodeGraphEffectReference', id: 'clock' },
		{ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect },
	];
	const renderers: TimelineLayerRenderer<TimelineImage>[] = [];
	try {
		const native = createEffectTimelineLayer(layer({ type: 'nativeEffect', id: 'solidColor' }, {
			color: { inputSource: 'literal', value: [4, -1, 0, 0.5] },
		}), catalog, options);
		renderers.push(native);
		const nativeSource = (await native.evaluate(context, signal)).source;
		if (nativeSource == null) throw new Error('Expected native layer output');
		const nativePixel = await readPixel(nativeSource);
		const colors: number[][] = [];
		let requests = 0;
		// 画像引数は省略する。Effect種別によらず主入力に下層を割り当て、Sceneの時計と内容時刻を別々に渡す。
		for (const source of sources) {
			const renderer = createEffectTimelineLayer(layer(source, { clock: { inputSource: 'envVariable', variable: 'TIME' } }), catalog, options);
			renderers.push(renderer);
			const evaluation = await renderer.evaluate({ ...context, getInput: async () => { requests++; return nativeSource; } }, signal);
			colors.push(await readPixel(evaluation.source));
		}
		const abort = new AbortController();
		const cancelled = await renderers[1].evaluate({ ...context, getInput: async () => { abort.abort(); return nativeSource; } }, abort.signal);
		const passThrough: CustomNodeGraphEffect = {
			paramDefs: { base: customShaderEffect.paramDefs.base }, outputDefs: { image: customShaderEffect.outputDefs.image },
			primaryInputId: 'base', primaryAudioInputId: null, primaryOutputId: 'image',
			nodes: [], outputs: { image: { type: 'publicParameter', parameterId: 'base' } },
		};
		const reference = createEffectTimelineLayer(layer({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: passThrough }, {
			base: { inputSource: 'anotherLayerOutput', layerId: 'source', outputStage: 'rendered', fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'linear' },
		}), catalog, options);
		renderers.push(reference);
		const references: unknown[] = [];
		const forwarded = await reference.evaluate({ ...context, getLayerOutput: async (id, stage) => {
			references.push([id, stage]);
			return { kind: 'uniform', value: [2, -1, 0.25, 0.5] };
		} }, signal);
		// 主色ポートを外したグラフは、公開主入力があっても下層の取得・合成を発生させない。
		const disconnected = createEffectTimelineLayer(layer({
			type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: { ...passThrough, outputs: {} },
		}, {}), catalog, options);
		renderers.push(disconnected);
		const absent = await disconnected.evaluate(context, signal);
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { nativePixel, colors, requests, references, forwarded: forwarded.source,
			cancelled: abort.signal.aborted && cancelled.source == null && cancelled.composite == null,
			absent: absent.source == null && absent.composite == null };
	} finally {
		for (const renderer of renderers.reverse()) renderer.destroy();
		readback.destroy();
		device.destroy();
	}
}
