import { createEffectTimelineLayer } from '@gs/subsystems_timeline_renderer/layers/effect/effect-timeline-layer.ts';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectImplementation } from '@gs/subsystems_effect_shared/effect-implementation.ts';
import fillDefinition from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
import fill from '@gs/subsystems_effect_shared/fx/fill/_impl_.ts';
import mixDefinition from '@gs/subsystems_effect_shared/fx/colorMix/_def_.ts';
import mix from '@gs/subsystems_effect_shared/fx/colorMix/_impl_.ts';
import meshDefinition from '@gs/subsystems_effect_shared/fx/meshGradient/_def_.ts';
import mesh from '@gs/subsystems_effect_shared/fx/meshGradient/_impl_.ts';
import { createLayerInputBinding, getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';

export async function checkEffectTimelineLayers(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	// 実際の登録一覧と同様、異なるパラメータ構造を持つ定義を共通の実行時契約へまとめる。
	const definitions: Record<string, EffectDefinition> = { fill: { ...fillDefinition }, colorMix: { ...mixDefinition }, meshGradient: { ...meshDefinition } };
	const implementations: Record<'fill' | 'colorMix' | 'meshGradient', EffectImplementation<any>> = { fill, colorMix: mix, meshGradient: mesh };
	// UIの生成処理はUIパッケージのテストで検証する。GPUテストの入力は共有定義から構築する。
	function createLayer(effectId: keyof typeof implementations): TimelineEffectLayer {
		const definition = definitions[effectId];
		return {
			id: effectId, name: definition.displayName, layerType: 'effect', effectId,
			clips: [{ id: 'clip', startMs: 100, durationMs: 5000, contentOffsetMs: 0 }],
			resolution: { mode: 'auto' }, automationGraphs: [],
			effectParamValues: Object.fromEntries(Object.keys(definition.paramDefs).map(key => [key, getEffectLayerParameterDefault(definition, key)])),
			compositingParamValues: {
				fitMode: structuredClone(timelineCompositingParamDefs.fitMode.defaultValue),
				opacity: structuredClone(timelineCompositingParamDefs.opacity.defaultValue),
				position: structuredClone(timelineCompositingParamDefs.position.defaultValue),
				origin: structuredClone(timelineCompositingParamDefs.origin.defaultValue),
				scale: structuredClone(timelineCompositingParamDefs.scale.defaultValue),
				rotation: structuredClone(timelineCompositingParamDefs.rotation.defaultValue),
				blendMode: { inputSource: 'literal', value: definition.kind === 'modify' ? 'replace' : 'normal' },
			},
		};
	}
	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
	const timeline = new TimelineRenderer<UniformOrTexture, TimelineEffectLayer>({
		fallbackOutput: { kind: 'uniform', value: [0, 0, 0, 0] },
		createLayer: layer => createEffectTimelineLayer(layer, definitions[layer.effectId as keyof typeof definitions], implementations[layer.effectId as keyof typeof implementations], {
			wgpu: { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
			fallbackTexture, resolution: { width: 4, height: 4 }, resolutionScale: 1, assets: [], assetTextures: new Map(),
		}),
	});
	const completed: string[] = [];
	async function check(name: string, layers: TimelineEffectLayer[], expected: number[]) {
		// 編集後と同じくインスタンスを再作成し、共有の既定値から実シェーダーまでを通す。
		timeline.clear();
		const result = await timeline.evaluateAt(350, layers, 0, true);
		if (result?.output.kind !== 'texture') throw new Error(`${name}: expected texture`);
		const actual = await read(result.output.texture);
		if (actual.length !== 64 || actual.some((value, index) => Math.abs(value - expected[index % 4]) > 2)) throw new Error(`${name}: ${actual} != ${expected}`);
		completed.push(name);
	}
	const background = createLayer('fill');
	background.effectParamValues.color = { inputSource: 'literal', value: [0, 0, 1, 0.5] };
	const modifier = createLayer('colorMix');
	modifier.clips[0].contentOffsetMs = 25;
	modifier.effectParamValues.inputB = { inputSource: 'literal', value: [1, 0, 0, 0.5] };
	modifier.effectParamValues.amount = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null, keyframesTimeline: {
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
		const meshLayer = createLayer('meshGradient');
		meshLayer.effectParamValues.colors = { inputSource: 'literal', value: [{ id: 'color', binding: createLayerInputBinding() }] };
		await check('array layer input with normal composition', [meshLayer, background], [0, 0, 192, 192]);
		return completed;
	} finally {
		timeline.clear();
		fallbackTexture.destroy();
	}
}
