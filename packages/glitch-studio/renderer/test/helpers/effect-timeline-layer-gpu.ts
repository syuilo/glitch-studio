import { createEffectTimelineLayer } from '../../src/effect-timeline-layer.ts';
import { TimelineRenderer } from '../../src/timeline-renderer.ts';
import type { NodeOutput } from '../../src/node-output.ts';
import { createEffectTimelineLayer as createLayer } from '../../../ui/src/utility/effect-timeline-layer.ts';
import fillDefinition from '../../../shared/src/effect/fx/fill/_def_.ts';
import fill from '../../../shared/src/effect/fx/fill/_impl_.ts';
import mixDefinition from '../../../shared/src/effect/fx/colorMix/_def_.ts';
import mix from '../../../shared/src/effect/fx/colorMix/_impl_.ts';
import meshDefinition from '../../../shared/src/effect/fx/meshGradient/_def_.ts';
import mesh from '../../../shared/src/effect/fx/meshGradient/_impl_.ts';
import { createLayerInputBinding } from '../../../shared/src/timeline/effect-layer.ts';
import type { TimelineEffectLayer } from '../../../shared/src/timeline/types.ts';

export async function checkEffectTimelineLayers(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	const definitions = { fill: fillDefinition, colorMix: mixDefinition, meshGradient: meshDefinition };
	const implementations = { fill, colorMix: mix, meshGradient: mesh };
	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
	const timeline = new TimelineRenderer<NodeOutput, TimelineEffectLayer>({
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
		createLayer: layer => createEffectTimelineLayer(layer, definitions[layer.effectId as keyof typeof definitions], implementations[layer.effectId as keyof typeof implementations], {
			wgpu: { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
			fallbackTexture, resolution: { width: 4, height: 4 }, resolutionScale: 1, assets: [], assetTextures: new Map(),
		}),
	});
	const completed: string[] = [];
	async function check(name: string, layers: TimelineEffectLayer[], expected: number[]) {
		// 編集後と同じくインスタンスを再作成し、UIの初期化から実シェーダーまでを通す。
		timeline.clear();
		const result = await timeline.evaluateAt(350, layers, 0, true);
		if (result?.output.kind !== 'texture') throw new Error(`${name}: expected texture`);
		const actual = await read(result.output.texture);
		if (actual.length !== 64 || actual.some((value, index) => Math.abs(value - expected[index % 4]) > 2)) throw new Error(`${name}: ${actual} != ${expected}`);
		completed.push(name);
	}
	const background = createLayer(fillDefinition, 100);
	background.effectParamValues.color = { inputSource: 'literal', value: [0, 0, 1, 0.5] };
	const modifier = createLayer(mixDefinition, 100);
	modifier.clips[0].contentOffsetMs = 25;
	modifier.effectParamValues.inputB = { inputSource: 'literal', value: [1, 0, 0, 0.5] };
	modifier.effectParamValues.amount = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', keyframesTimeline: {
		dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'start', x: 100, value: 0, interpolation: { type: 'linear' } },
			{ id: 'end', x: 600, value: 1, interpolation: { type: 'linear' } },
		],
	} };
	try {
		// 【生成系の通常合成と加工系の置換を実画素で確認する】
		// 下層画像の二重合成・アルファの二重乗算や、キーを内容時刻で評価する誤りを検出する。
		await check('generated layer on transparent background', [background], [0, 0, 128, 128]);
		await check('modify layer with scene-time keyframes', [modifier, background], [64, 0, 64, 128]);
		await check('missing lower layer is transparent', [modifier], [64, 0, 0, 64]);
		modifier.effectParamValues.inputA = { inputSource: 'literal', value: [0, 1, 0, 0.5] };
		modifier.effectParamValues.inputB = createLayerInputBinding();
		await check('secondary layer input', [modifier, background], [0, 64, 64, 128]);
		modifier.effectParamValues.amount = { inputSource: 'literal', value: 0 };
		modifier.compositingParamValues.opacity = { inputSource: 'literal', value: 0.5 };
		await check('replace opacity blends both premultiplied images', [modifier, background], [0, 64, 64, 128]);
		// 【配列要素の下層入力も生成系の通常合成を経由する】
		// 配列ID・Bindingラッパーをシェーダーへ漏らさず、要素ごとの入力として解決する。
		const meshLayer = createLayer(meshDefinition, 100);
		meshLayer.effectParamValues.colors = { inputSource: 'literal', value: [{ id: 'color', binding: createLayerInputBinding() }] };
		await check('array layer input with normal composition', [meshLayer, background], [0, 0, 192, 192]);
		return completed;
	} finally {
		timeline.clear();
		fallbackTexture.destroy();
	}
}
