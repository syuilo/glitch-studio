import { EffectRenderer } from '@gs/subsystems_effect_renderer/effect-renderer.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import gradientDefinition from '@gs/subsystems_effect_shared/fx/gradient/_def_.ts';
import gradient from '@gs/subsystems_effect_shared/fx/gradient/_impl_.ts';
import pixelSortDefinition from '@gs/subsystems_effect_shared/fx/pixelSort/_def_.ts';
import pixelSort from '@gs/subsystems_effect_shared/fx/pixelSort/_impl_.ts';
import lightTracingDefinition from '@gs/subsystems_effect_shared/fx/lightTracing2d/_def_.ts';
import lightTracing from '@gs/subsystems_effect_shared/fx/lightTracing2d/_impl_.ts';
import feedbackDefinition from '@gs/subsystems_effect_shared/fx/feedback/_def_.ts';
import feedback from '@gs/subsystems_effect_shared/fx/feedback/_impl_.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectImplementation, RuntimeEffectParameters } from '@gs/subsystems_effect_shared/effect-implementation.ts';
import type { EffectRenderTiling } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import mandelbrotDefinition from '@gs/subsystems_effect_shared/fx/mandelbrot/_def_.ts';
import mandelbrot from '@gs/subsystems_effect_shared/fx/mandelbrot/_impl_.ts';

export async function checkEffectRenderTiles(device: GPUDevice, vertex: GPUShaderModule, read: (texture: GPUTexture) => Promise<number[]>) {
	const completed: string[] = [];
	for (const [width, height] of [[9, 7], [1, 5], [129, 65]]) {
		const resolution = { width, height };
		const input = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const pixels = Uint8Array.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? 128 + index % 128 : (index * 37) % 256);
		device.queue.writeTexture({ texture: input }, pixels, { bytesPerRow: width * 4 }, resolution);
		const shaderInput = { kind: 'texture' as const, texture: input, fitMode: 'cover' as const, wrapMode: 'clamp' as const, filterMode: 'linear' as const };
		async function compare<Definition extends EffectDefinition>(definition: Definition, implementation: EffectImplementation<Definition>, overrides: Record<string, unknown> = {}, frames = 1) {
			const params = { ...Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key,
				def.canNode ? constantShaderInput(def.dataType.kind, def.defaultValue.value) : def.defaultValue.value])), ...overrides } as RuntimeEffectParameters<Definition['paramDefs']>;
			const settings: EffectRenderTiling[] = [1, 2, 4].map(level => ({ mode: 'manual', tileSize: Math.max(1, Math.ceil(Math.max(width, height) / (2 ** level))) }));
			settings.push({ mode: 'auto' });
			const create = (tiling: EffectRenderTiling) => new EffectRenderer({ definition: { ...definition, canHaveLongRunningRenderPass: true }, implementation, resolution, staticResources: {}, fallbackTexture: input,
				enableStats: tiling.mode !== 'auto' && device.features.has('timestamp-query'), effectRenderTiling: tiling, wgpu: { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false } });
			const baseline = create({ mode: 'disabled' });
			const divided = settings.map(tiling => create(tiling));
			try {
				for (let frame = 0; frame < frames; frame++) {
					const context = { params, time: frame / 30, timeDelta: 1000 / 30, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 } };
					const encoder = device.createCommandEncoder();
					baseline.render({ ...context, commandEncoder: encoder });
					device.queue.submit([encoder.finish()]);
					const expected = new Map<string, number[]>();
					for (const port of Object.keys(definition.outputDefs)) {
						const texture = baseline.getOutputTexture(port);
						if (texture != null) expected.set(port, await read(texture));
					}
					for (const [index, renderer] of divided.entries()) {
						const gpuTime = await renderer.renderTiled(context);
						if (!Number.isFinite(gpuTime) || gpuTime < 0) throw new Error('Invalid tiled GPU timing.');
						for (const [port, values] of expected) {
							const actual = await read(renderer.getOutputTexture(port)!);
							const name = `${definition.id} ${width}x${height} tiling=${JSON.stringify(settings[index])} frame=${frame} port=${port}`;
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
