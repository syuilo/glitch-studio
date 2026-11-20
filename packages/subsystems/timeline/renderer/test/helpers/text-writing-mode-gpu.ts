import { createTextureReader } from './read-texture.ts';
import definition from '@gs/subsystems_effect-new_native-effects/fx/text/_def_.ts';
import implementation from '@gs/subsystems_effect-new_native-effects/fx/text/_impl_.ts';
import { createEffectTimelineLayer } from '../../src/layers/effect/effect-timeline-layer.ts';
import { testEffectLayer, testLayerContext } from './effect-layer-fixture.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createTextRenderer } from '../../src/text-rendering/text-renderer.ts';
import type { TextRenderValues } from '../../src/text-rendering/text-render-values.ts';

function unexpected(): never { throw new Error('Unexpected Effect reference'); }

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const vertex = device.createShaderModule({ code: vertexCode });
	device.pushErrorScope('validation');
	const checks: string[] = [];
	const previews: OffscreenCanvas[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const read = createTextureReader(device);
	try {
		for (const [width, height] of [[480, 320], [320, 480]]) {
			const resolution = { width, height };
			const wgpu = { device, enable32bitDataTextures: false, defaultVertexShaderModule: vertex };
			const layer = testEffectLayer({ type: 'nativeEffect', id: 'text' });
			const effect = createEffectTimelineLayer(layer, {
				wgpu, sceneBaseResolution: resolution, resolutionScale: 1,
				definitions: { getNativeEffect: () => definition, getCustomNodeGraphEffect: unexpected, getCustomShaderEffect: unexpected },
				getNativeEffectImplementation: () => implementation,
			});
			const signal = new AbortController().signal;
			const timeline = createTextRenderer({ device, vertex, resolution, fontFileSource: null });
			await timeline.waitUntilReady(new AbortController().signal);
			try {
				for (const writingMode of ['horizontal-tb', 'vertical-rl'] as const) {
					for (const overflow of ['none', 'shrink', 'compress'] as const) {
						for (const align of ['left', 'center', 'right'] as const) {
							const values: TextRenderValues = {
								text: '縦書き「AV 123」。\nかなーか\u3099😀', writingMode, overflow, align,
								size: 0.075, maxWidth: 0.6, maxHeight: 0.6, lineHeight: 1.4,
								position: [0.04, -0.02], color: [1, 1, 1, 0.7], outlineWidth: 0.08, outlineColor: [1, 0.2, 0.1, 0.8],
								shadowEnabled: true, shadowColor: [0.3, 0.5, 1, 0.6], shadowOffset: [0.2, -0.15], shadowBlur: 0.06,
							};
							for (const [key, value] of Object.entries(values)) layer.effectParamValues[key] = { inputSource: 'literal', value };
							const { source } = await effect.evaluate(testLayerContext(), signal);
							if (source == null) throw new Error('Missing Native Effect texture');
							const encoder = device.createCommandEncoder();
							const image = timeline.render(encoder, values);
							device.queue.submit([encoder.finish()]);
							assert(image.kind === 'texture' && image.region != null, 'Timeline text must retain its crop region');
							if (image.kind !== 'texture' || image.region == null) throw new Error('Missing Timeline texture');
							const expected = await read(source.texture);
							const cropped = new OffscreenCanvas(image.texture.width, image.texture.height);
							cropped.getContext('2d')!.putImageData(new ImageData(await read(image.texture), image.texture.width, image.texture.height), 0, 0);
							const restored = new OffscreenCanvas(width, height);
							const context = restored.getContext('2d')!;
							const { bounds } = image.region;
							context.drawImage(cropped, (bounds.left + 1) * width / 2, (1 - bounds.top) * height / 2,
								(bounds.right - bounds.left) * width / 2, (bounds.top - bounds.bottom) * height / 2);
							const actual = context.getImageData(0, 0, width, height).data;
							// Canvasへ戻すと非乗算色になるため、比較は被覆率のalphaだけを使う。
							let alphaDifference = 0;
							let alphaSum = 0;
							for (let index = 3; index < expected.length; index += 4) {
								alphaDifference += Math.abs(actual[index] - expected[index]);
								alphaSum += expected[index];
							}
							assert(alphaSum > 10000, 'Text must produce visible pixels');
							assert(alphaDifference / alphaSum < 0.025, `${writingMode}/${overflow}/${align} ${width}x${height}: cropped mask differs by ${alphaDifference / alphaSum}`);
							checks.push(`${writingMode}/${overflow}/${align} ${width}x${height}`);
							if (width === 320 && overflow === 'none' && align === 'center') previews.push(restored);
						}
					}
				}
			} finally {
				effect.destroy();
				timeline.dispose();
			}
		}
		const preview = new OffscreenCanvas(640, 480);
		const context = preview.getContext('2d')!;
		context.fillStyle = '#17202b';
		context.fillRect(0, 0, 640, 480);
		previews.forEach((canvas, index) => context.drawImage(canvas, index * 320, 0));
		const blob = await preview.convertToBlob({ type: 'image/png' });
		const previewData = await new Promise<string>(resolve => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result).split(',')[1]);
			reader.readAsDataURL(blob);
		});
		const validation = await device.popErrorScope();
		assert(validation == null, validation?.message ?? 'GPU validation error');
		return { checks, preview: previewData };
	} finally {
		device.destroy();
	}
}
