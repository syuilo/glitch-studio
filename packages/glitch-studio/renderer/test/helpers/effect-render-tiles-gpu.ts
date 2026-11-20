import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import { createTestInputs } from '@gs/subsystems_effect_native-effects/test/native-effect-probe.ts';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import gradientDefinition from '@gs/subsystems_effect_native-effects/fx/gradient/_def_.ts';
import gradient from '@gs/subsystems_effect_native-effects/fx/gradient/_impl_.ts';
import pixelSortDefinition from '@gs/subsystems_effect_native-effects/fx/pixelSort/_def_.ts';
import pixelSort from '@gs/subsystems_effect_native-effects/fx/pixelSort/_impl_.ts';
import lightTracingDefinition from '@gs/subsystems_effect_native-effects/fx/lightTracing2d/_def_.ts';
import lightTracing from '@gs/subsystems_effect_native-effects/fx/lightTracing2d/_impl_.ts';
import feedbackDefinition from '@gs/subsystems_effect_native-effects/fx/feedback/_def_.ts';
import feedback from '@gs/subsystems_effect_native-effects/fx/feedback/_impl_.ts';
import type { NativeEffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { EffectRenderTiling } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import mandelbrotDefinition from '@gs/subsystems_effect_native-effects/fx/mandelbrot/_def_.ts';
import mandelbrot from '@gs/subsystems_effect_native-effects/fx/mandelbrot/_impl_.ts';

export async function checkEffectRenderTiles(device: GPUDevice, vertex: GPUShaderModule, read: (texture: GPUTexture) => Promise<number[]>) {
	const completed: string[] = [];
	for (const [width, height] of [[9, 7], [1, 5], [129, 65]]) {
		const resolution = { width, height };
		const input = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const pixels = Uint8Array.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? 128 + index % 128 : (index * 37) % 256);
		device.queue.writeTexture({ texture: input }, pixels, { bytesPerRow: width * 4 }, resolution);
		const shaderInput = textureShaderInput(input, { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' });
		async function compare(definition: NativeEffectDefinition, implementation: NativeEffectImplementation, overrides: Record<string, unknown> = {}, frames = 1) {
			const inputs = createTestInputs(definition.paramDefs, () => overrides);
			const settings: EffectRenderTiling[] = [1, 2, 4].map(level => ({ mode: 'manual', tileSize: Math.max(1, Math.ceil(Math.max(width, height) / (2 ** level))) }));
			settings.push({ mode: 'auto' });
			const create = (tiling: EffectRenderTiling) => createEffectInstance({ effectSource: { type: 'nativeEffect', id: 'native' },
				definitions: { getNativeEffect: () => ({ ...definition, canHaveLongRunningRenderPass: true }) }, resolution, inputs, tiling,
				usedOutputPorts: new Set(Object.keys(definition.outputDefs)), onGpuTime: tiling.mode !== 'auto' && device.features.has('timestamp-query')
					? (_path, _pass, time) => { if (time != null && (!Number.isFinite(time) || time < 0)) throw new Error('Invalid GPU time'); } : undefined },
				{ device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false }, () => implementation);
			const baseline = await create({ mode: 'disabled' });
			const divided = await Promise.all(settings.map(create));
			try {
				for (let frame = 0; frame < frames; frame++) {
					const context = { time: frame / 30, timeDelta: 1000 / 30 };
					const encoder = device.createCommandEncoder();
					await baseline.prepare(context);
					baseline.render(context, encoder);
					device.queue.submit([encoder.finish()]);
					const expected = new Map<string, number[]>();
					for (const port of Object.keys(definition.outputDefs)) {
						const output = baseline.outputs.get(port);
						if (output?.kind === 'texture') expected.set(port, await read(output.texture));
					}
					for (const [index, renderer] of divided.entries()) {
						await renderer.renderTiled(context);
						for (const [port, values] of expected) {
							const output = renderer.outputs.get(port);
							if (output?.kind !== 'texture') throw new Error('Expected a tiled texture');
							const actual = await read(output.texture);
							const name = `${definition.displayName} ${width}x${height} tiling=${JSON.stringify(settings[index])} frame=${frame} port=${port}`;
							if (actual.length !== values.length || actual.some((value, pixel) => Math.abs(value - values[pixel]) > 1)) throw new Error(`Tiled pixel mismatch: ${name}`);
							completed.push(name);
						}
					}
				}
			} finally {
				baseline.dispose();
				for (const renderer of divided) renderer.dispose();
			}
		}
		try {
			// MRT、Compute後のScissor描画、別解像度の多段画像参照、履歴交換を実エフェクトで検証する。
			await compare(gradientDefinition, gradient);
			await compare(mandelbrotDefinition, mandelbrot, { view: { center: [-0.5, 0], zoom: 1, rotation: 0 }, maximumIterations: 16 });
			if (width > 9) continue;
			await compare(pixelSortDefinition, pixelSort, { input: shaderInput, thresholdMax: 1 });
			await compare(lightTracingDefinition, lightTracing, { input: shaderInput, rayCount: 4, maxSteps: 8 });
			await compare(feedbackDefinition, feedback, { input: shaderInput }, 2);
		} finally { input.destroy(); }
	}
	return completed;
}
