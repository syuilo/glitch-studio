import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { appendVisibleCircularBandSources, MAX_CIRCULAR_BAND_PRESSES } from '../../circular-band-sources.ts';
import type { CircularBandSource } from '../../circular-band-sources.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { gradientInterpolationParameter } from '../../gradient-interpolation.ts';
import type definition from './_def_.ts';
import code, { uniforms } from './shader.shader.ts?shader';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init(context) {
		const { device, inputs, resolution, outputTextures } = context;
		const halfExtent = getSpatialHalfExtent(resolution);
		const uniformValues = createShaderBuffer(uniforms.params);
		uniformValues.set({ halfExtent });
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const vector = outputTextures.get('vector');
		const fullscreen = await createFullscreenEffect(context, {
			code,
			schema: {},
			inputs,
			outputPorts: vector == null ? ['scalar'] : ['scalar', 'vector'],
			entryPoint: vector == null ? 'fs' : 'fsWithGradient',
			constants: vector == null ? { CALCULATE_GRADIENT: 0 } : {
				CALCULATE_GRADIENT: 1,
				MAX_GRADIENT: vector.format === 'rg32float' ? 3.4028234663852886e38 : 65504,
			},
			internalLayouts: [layout],
			bindResources(pass) { pass.setBindGroup(0, bindGroup); },
			disposeResources() { uniformBuffer.destroy(); },
		});

		// 押下履歴と内容時刻だけが更新されたフレームも描画するため、全画面パスの固定cacheKeyは公開しない。
		return {
			render(frame) {
				const speed = inputs.speed.value;
				const width = inputs.width.value;
				const duration = inputs.duration.value;
				const reflectivity = Math.min(1, Math.max(0, inputs.reflectivity.value));
				const bands: CircularBandSource[] = [];
				let activePressCount = 0;
				if (frame.pointerClicks != null && speed > 0 && width > 0) {
					for (const click of frame.pointerClicks) {
						const age = frame.time - click.time;
						if (age < 0 || (duration > 0 && age >= duration)) continue;
						// 1 - smoothstep(0, duration, age)を残り時間から求め、終端付近の桁落ちを避ける。
						const remaining = duration > 0 ? 1 - age / duration : 1;
						const fade = remaining * remaining * (3 - 2 * remaining);
						const previousBandCount = bands.length;
						appendVisibleCircularBandSources(bands, { center: click.position, radius: speed * age, fade }, halfExtent, width, reflectivity);
						if (bands.length > previousBandCount && ++activePressCount === MAX_CIRCULAR_BAND_PRESSES) break;
					}
				}
				uniformValues.set({
					bands,
					bandCount: bands.length,
					width,
					interpolation: gradientInterpolationParameter.dataType.options.indexOf(inputs.interpolation.value),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				fullscreen.render(frame);
			},
			dispose: fullscreen.dispose,
		};
	},
};

export default implementation;
