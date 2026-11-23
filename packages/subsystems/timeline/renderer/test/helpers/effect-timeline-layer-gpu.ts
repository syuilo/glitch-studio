import vertex from '@gs/shared/gpu/vertex.wgsl?raw';
import fillDefinition from '@gs/subsystems_effect_native-effects/fx/fill/_def_.ts';
import fillImplementation from '@gs/subsystems_effect_native-effects/fx/fill/_impl_.ts';
import { createEffectTimelineLayer } from '../../src/layers/effect/effect-timeline-layer.ts';
import { testEffectLayer, testLayerContext } from './effect-layer-fixture.ts';
import { createTextureReader } from './read-texture.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import { acquireTransparentTimelineImage, type TimelineImage } from '../../src/timeline-image.ts';

const literal = <T>(value: T) => ({ inputSource: 'literal' as const, value });
const color = { dataType: { kind: 'color' }, canNode: true, ui: { label: 'Color', control: {} }, defaultValue: [0, 0, 0, 0] as [number, number, number, number] } as const;
const output = { dataType: { kind: 'color' }, nameForReference: 'image' } as const;
const common = { kind: 'generate', primaryInputParameter: null, primaryOutput: 'out', resolutionInputParameters: [], outputDefs: { out: output } } as const;
const shader: CustomShaderEffect = {
	...common, shaderApiVersion: 1,
	paramDefs: { a: { ...color, nameForReference: 'a' }, b: { ...color, nameForReference: 'b' } },
	code: 'fn main(pos: vec2f) -> Output { return Output((read_a(pos) + read_b(pos)) * 0.5); }',
};
const direct: NodesEffect = { ...common, paramDefs: { color }, nodes: [], outputSources: { out: { parameterId: 'color' } } };
const solid: NodesEffect = {
	...common, paramDefs: { color: { ...color, canNode: false } },
	nodes: [{ id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' },
		params: { color: { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'color' } } }],
	outputSources: { out: { nodeId: 'fill', outputPort: 'output' } },
};

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU unavailable');
	const device = await adapter.requestDevice();
	const signal = new AbortController().signal;
	const options = {
		wgpu: { device, defaultVertexShaderModule: device.createShaderModule({ code: vertex }), enable32bitDataTextures: false },
		sceneBaseResolution: { width: 16, height: 12 }, resolutionScale: 0.5,
		definitions: { getNativeEffect: (id: string) => id === 'fill' ? fillDefinition : unexpected(), getNodesEffect: () => solid, getCustomShaderEffect: () => shader },
		getNativeEffectImplementation: (id: string) => id === 'fill' ? fillImplementation : unexpected(),
	};
	function unexpected(): never { throw new Error('Unexpected Effect lookup'); }
	const read = createTextureReader(device);
	async function check(image: TimelineImage | null | undefined, width: number, height: number, expected: number[] | ((x: number, y: number) => number[])) {
		if (image?.kind !== 'texture' || image.texture.width !== width || image.texture.height !== height) throw new Error('Unexpected Timeline texture or dimensions');
		const pixels = await read(image.texture);
		for (let i = 0; i < pixels.length; i += 4) {
			const rgba = typeof expected === 'function' ? expected((i / 4) % width, Math.floor(i / 4 / width)) : expected;
			for (let channel = 0; channel < 4; channel++) {
				if (Math.abs(pixels[i + channel] - rgba[channel]) > 1) throw new Error('Unexpected pixel ' + i / 4 + ' channel ' + channel + ': ' + pixels[i + channel]);
			}
		}
	}
	// 4×3から8×6へのlinear拡大では最外周の画素中心が透明な隣接画素を1/4ずつ含む。
	function upsampledRed(x: number, y: number) {
		const coverage = (x === 0 || x === 7 ? 0.75 : 1) * (y === 0 || y === 5 ? 0.75 : 1);
		return [255 * coverage, 0, 0, 255 * coverage];
	}
	device.pushErrorScope('validation');
	const context = testLayerContext();
	const backgroundLayer = testEffectLayer({ type: 'nodesEffectReference', id: 'color' });
	backgroundLayer.effectParamValues.color = literal([1, 0, 0, 1]);
	backgroundLayer.resolution = { mode: 'customAbsolute', width: 8, height: 6 };
	const background = createEffectTimelineLayer(backgroundLayer, options);
	try {
		const first = acquireTransparentTimelineImage(device, { width: 8, height: 6 });
		const second = acquireTransparentTimelineImage(device, { width: 8, height: 6 });
		if (first.image.texture !== second.image.texture) throw new Error('Expected one shared fallback');
		first.release();
		first.release();
		try { await check(second.image, 8, 6, [0, 0, 0, 0]); }
		finally { second.release(); }
		const red = (await background.evaluate(context, signal)).source!;
		await check(red, 4, 3, [255, 0, 0, 255]);
		// 加工系Nodes Effectの主入力は下層へ接続され、原寸の素材を有限のScene画像へ確定して渡す。
		const passthrough = createEffectTimelineLayer(testEffectLayer({ type: 'inlineNodesEffect',
			nodesEffect: { ...direct, kind: 'modify', primaryInputParameter: 'color' } }), options);
		try {
			const image = (await passthrough.evaluate({ ...context, getInput: async () => red }, signal)).source;
			await check(image, 8, 6, upsampledRed);
		} finally { passthrough.destroy(); }
		const sources: EffectSource[] = [{ type: 'customShaderEffectReference', id: 'mix' }, { type: 'inlineCustomShaderEffect', customShaderEffect: shader }];
		for (const effectSource of sources) {
			const layer = testEffectLayer(effectSource);
			layer.effectParamValues.a = layer.effectParamValues.b = { inputSource: 'anotherLayerOutput', layerId: 'red', outputStage: 'rendered' };
			const renderer = createEffectTimelineLayer(layer, { ...options, tiling: { mode: 'manual', tileSize: 4 } });
			try {
				let fetches = 0;
				const result = await renderer.evaluate({ ...context, async getLayerOutput(id, stage) {
					if (id !== 'red' || stage !== 'rendered') throw new Error('Wrong Timeline stage');
					fetches++;
					return red;
				} }, signal);
				await check(result.source, 8, 6, upsampledRed);
				if (fetches !== 1) throw new Error('Timeline input fetched multiple times');
			} finally { renderer.destroy(); }
		}
		// 同じShaderでも内部の式にはクリップの内容時刻、終端、進捗を渡す。未使用の公開入力は評価しない。
		const nestedNodesEffect: NodesEffect = {
			...common, paramDefs: { unused: color }, resolutionInputParameters: ['unused'],
			nodes: [{
				id: 'shader', effectSource: { type: 'customShaderEffectReference', id: 'mix' },
				params: { a: { inputSource: 'expression', expression: '[TIME, END_TIME / 4, PROGRESS, 1]' },
					b: { inputSource: 'expression', expression: '[TIME, END_TIME / 4, PROGRESS, 1]' } },
			}],
			outputSources: { out: { nodeId: 'shader', outputPort: 'out' } },
		};
		const nestedLayer = testEffectLayer({ type: 'inlineNodesEffect', nodesEffect: nestedNodesEffect });
		nestedLayer.effectParamValues.unused = { inputSource: 'lowerLayerOutput' };
		const nested = createEffectTimelineLayer(nestedLayer, options);
		try { await check((await nested.evaluate(context, signal)).source, 8, 6, [64, 128, 32, 255]); }
		finally { nested.destroy(); }
		const layer = testEffectLayer({ type: 'inlineNodesEffect', nodesEffect: solid });
		layer.resolution = { mode: 'customAbsolute', width: 8, height: 6 };
		layer.compositingParamValues.blendMode = literal('replace');
		layer.effectParamValues.color = { inputSource: 'expression', expression: '[TIME, 0, 0, 0.5]' };
		const renderer = createEffectTimelineLayer(layer, options);
		try {
			const result = await renderer.evaluate(context, signal);
			await check(result.source, 4, 3, [115, 0, 0, 128]);
			layer.effectParamValues.color.expression = '[0, 0, 0, 0]';
			const transparent = await renderer.evaluate(context, signal);
			await check(transparent.source, 4, 3, [0, 0, 0, 0]);
			if (result.source?.texture !== transparent.source?.texture) throw new Error('Fill output texture was recreated');
			await check(await transparent.composite!(red, signal), 4, 3, [0, 0, 0, 0]);
		} finally { renderer.destroy(); }
		// 【Outに直結した値や空のOutは、透明なFillと違って背景を置き換えない】
		// 合成を起動すると、replaceのレイヤーが下層画像を消してしまう。
		for (const nodesEffect of [direct, { ...direct, outputSources: {} }]) {
			const layer = testEffectLayer({ type: 'inlineNodesEffect', nodesEffect });
			layer.compositingParamValues.blendMode = literal('replace');
			layer.effectParamValues.color = literal([1, 0, 0, 1]);
			const disconnected = createEffectTimelineLayer(layer, options);
			try {
				const result = await disconnected.evaluate(context, signal);
				if (result.source != null || result.composite != null) throw new Error('Absent output cleared the background');
			} finally { disconnected.destroy(); }
		}
		const validation = await device.popErrorScope();
		if (validation != null) throw new Error(validation.message);
		return { checked: true };
	} finally { background.destroy(); device.destroy(); }
}
