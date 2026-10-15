import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { createShapeTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/shape/shape-timeline-layer.ts';
import { createGroupTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/group/group-timeline-layer.ts';
import { createShape } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineLayer, TimelineGroupLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayerRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';

/** 固定シナリオのCPU評価からGPU完了までを計測する。環境依存なので合否の閾値にはしない。 */
export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (!adapter) throw new Error('WebGPU unavailable');
	const device = await adapter.requestDevice();
	const vertex = device.createShaderModule({ code: vertexCode });
	const options = { device, vertex, resolution: { width: 1920, height: 1080 }, format: 'rgba16float' as const };
	const literal = (value: any) => ({ inputSource: 'literal' as const, value });
	const compositing = () => Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])) as TimelineGroupLayer['compositingParamValues'];
	const common = { isDisabled: false, forceDisableMotionBlur: false, mask: null, coordinateSpace: 'world' as const, automationGraphs: [] };
	const shapes: TimelineLayer[] = Array.from({ length: 12 }, (_, index) => {
		const shape = createShape('rectangle');
		shape.paramValues.size = literal([0.25, 0.2]);
		shape.paramValues.position = literal([(index % 4 - 1.5) * 0.35, (Math.floor(index / 4) - 1) * 0.4]);
		return { ...common, id: String(index), name: 'Shape', layerType: 'shape', shape, compositingParamValues: compositing(),
			clips: [{ id: 'clip', startMs: 0, durationMs: 10000, contentOffsetMs: 0 }] };
	});
	const grouped: TimelineLayer[] = Array.from({ length: 4 }, (_, index) => ({ ...common, id: `group${index}`, name: 'Group', layerType: 'group',
		layers: shapes.slice(index * 3, index * 3 + 3), compositingParamValues: compositing(), audioParamValues: { volume: literal(1) } }));
	const createLayer = (layer: TimelineLayer): TimelineLayerRenderer<UniformOrTexture> => layer.layerType === 'group'
		? createGroupTimelineLayer(() => layer, { ...options, createLayer, getLayerVersion: () => 0 })
		: layer.layerType === 'shape' ? createShapeTimelineLayer(layer, options) : (() => { throw new Error('Unexpected layer'); })();
	const renderer = new TimelineRenderer<UniformOrTexture, TimelineLayer>({ fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] }, createLayer });
	const results: string[] = [];
	try {
		for (const [name, layers] of [['12 shapes', shapes], ['4 flat groups / 12 shapes', grouped]] as const) {
			renderer.clear();
			for (let index = 0; index < 10; index++) await renderer.evaluateAt(index, layers, 0, false);
			await device.queue.onSubmittedWorkDone();
			const samples: number[] = [];
			for (let trial = 0; trial < 5; trial++) {
				const start = performance.now();
				for (let index = 0; index < 20; index++) {
					await renderer.evaluateAt(index + 100, layers, 0, false);
					await device.queue.onSubmittedWorkDone();
				}
				samples.push((performance.now() - start) / 20);
			}
			results.push(`${name}: ${samples.sort((a, b) => a - b)[2].toFixed(2)} ms/frame (median of 5 x 20 frames)`);
		}
		return results;
	} finally { renderer.clear(); device.destroy(); }
}
