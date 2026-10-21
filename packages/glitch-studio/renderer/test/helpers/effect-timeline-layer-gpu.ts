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
import blurDefinition from '@gs/subsystems_effect_shared/fx/blur/_def_.ts';
import blur from '@gs/subsystems_effect_shared/fx/blur/_impl_.ts';
import { createLowerLayerOutputBinding, getEffectLayerParameterDefault } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineImage } from '@gs/subsystems_timeline_renderer/timeline-image.ts';

export async function checkBlurRegionTimelineLayer(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	const resolution = { width: 8, height: 4 };
	const background = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const backgroundPixels = Array.from({ length: 32 }, (_, index) => index % 8 < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]).flat();
	device.queue.writeTexture({ texture: background }, new Uint8Array(backgroundPixels), { bytesPerRow: 32 }, resolution);
	const image: TimelineImage = { kind: 'texture', texture: background };
	const layer: TimelineEffectLayer = {
		id: 'blur', name: 'Blur', layerType: 'effect', effectId: 'blur', transformTarget: 'region',
		isDisabled: false, color: null, forceDisableMotionBlur: false, mask: null, coordinateSpace: 'screen',
		clips: [{ id: 'clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }], resolution: { mode: 'auto' }, automationGraphs: [],
		effectParamValues: Object.fromEntries(Object.keys(blurDefinition.paramDefs).map(key => [key, getEffectLayerParameterDefault(blurDefinition, key)])),
		compositingParamValues: {
			...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])) as TimelineEffectLayer['compositingParamValues'],
			position: { inputSource: 'literal', value: [0.5, 0] }, scale: { inputSource: 'literal', value: [0.5, 1] }, blendMode: { inputSource: 'literal', value: 'replace' },
		},
	};
	const renderer = createEffectTimelineLayer(layer, blurDefinition, blur, {
		wgpu: { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' },
		fallbackTexture: background, resolution, resolutionScale: 1, assets: [], assetTextures: new Map(),
	});
	const context = { sceneTimeMs: 0, contentTimeMs: 0, timeDelta: 0, isExport: true, clipElapsedTimeMs: 0, clipDurationMs: 1000, contentEndTimeMs: 1000,
		getInput: async () => image, getLayerOutput: async () => image };
	const completed: string[] = [];
	async function pixels(output: TimelineImage | null | undefined) {
		if (output?.kind !== 'texture') throw new Error('Expected a rendered blur texture');
		return read(output.texture);
	}
	function check(name: string, actual: number[], expected: number[]) {
		if (actual.length !== expected.length || actual.some((value, index) => Math.abs(value - expected[index]) > 2)) throw new Error(`${name}: ${actual} != ${expected}`);
		completed.push(name);
	}
	try {
		// 【本物のBlurの素材・単独描画・合成結果を独立して読む】
		// 合成が素材を上書きしたり、範囲の端で入力を切ってぼかしに必要な周囲を失う不具合を防ぐ。
		const result = await renderer.evaluate(context, new AbortController().signal);
		const source = await pixels(result.source);
		const rendered = await pixels(result.rendered?.());
		const composited = await pixels(result.composite?.(image));
		check('blur region renders only the selected area on transparency', rendered, source.map((value, index) => Math.floor(index / 4) % 8 < 4 ? 0 : value));
		check('blur region composites over the original fixed background', composited, source.map((value, index) => Math.floor(index / 4) % 8 < 4 ? backgroundPixels[index] : value));
		check('blur source remains available after rendering and compositing', await pixels(result.source), source);
		if (source[4 * 4] <= 0 || source[4 * 4 + 1] <= 0) throw new Error('Blur must sample colors outside the application region');
		// 【範囲を移動してもBlur自身の計算結果・半径は変えない】
		// positionを入力側へ混ぜるとノイズの位置やサンプル範囲まで動き、素材参照の結果も変わってしまう。
		layer.compositingParamValues.position = { inputSource: 'literal', value: [-0.5, 0] };
		const moved = await renderer.evaluate(context, new AbortController().signal);
		check('blur source stays fixed when its application region moves', await pixels(moved.source), source);
		check('blur region moves to the other half without moving the background', await pixels(moved.composite?.(image)), source.map((value, index) => Math.floor(index / 4) % 8 < 4 ? value : backgroundPixels[index]));
		return completed;
	} finally { renderer.destroy(); background.destroy(); }
}

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
			forceDisableMotionBlur: false,
			mask: null, coordinateSpace: 'screen',
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
		modifier.effectParamValues.inputB = createLowerLayerOutputBinding();
		await check('secondary lowerLayerOutput', [modifier, background], [0, 64, 64, 128]);
		modifier.effectParamValues.amount = { inputSource: 'literal', value: 0 };
		modifier.compositingParamValues.opacity = { inputSource: 'literal', value: 0.5 };
		await check('replace opacity blends both premultiplied images', [modifier, background], [0, 64, 64, 128]);
		// 【配列要素の下層入力も生成系の通常合成を経由する】
		// 配列ID・Bindingラッパーをシェーダーへ漏らさず、要素ごとの入力として解決する。
		const meshLayer = createLayer('meshGradient');
		meshLayer.effectParamValues.colors = { inputSource: 'literal', value: [{ id: 'color', binding: createLowerLayerOutputBinding() }] };
		await check('array lowerLayerOutput with normal composition', [meshLayer, background], [0, 0, 192, 192]);
		return completed;
	} finally {
		timeline.clear();
		fallbackTexture.destroy();
	}
}
