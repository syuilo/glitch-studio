import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import type definition from './_def_.ts';
import code, { uniforms } from './shader.wgsl?shader';

const MAX_ACTIVE_RIPPLES = 16; // shader.wgslのUniforms.ripplesと同じ上限。

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init(context) {
		const { device, inputs, resolution } = context;
		const halfExtent = getSpatialHalfExtent(resolution);
		const uniformValues = createShaderBuffer(uniforms.params);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const fullscreen = await createFullscreenEffect(context, {
			code,
			schema: {},
			inputs,
			outputPorts: ['output', 'mask'],
			internalLayouts: [layout],
			bindResources(pass) { pass.setBindGroup(0, bindGroup); },
			disposeResources() { uniformBuffer.destroy(); },
		});

		// 通常パラメータが同じでもクリックと内容時刻で結果が変わるため、全画面パスの固定cacheKeyは公開しない。
		return {
			render(frame) {
				const speed = inputs.speed.value;
				const duration = inputs.duration.value;
				const width = inputs.width.value;
				const ripples: { center: readonly [number, number]; radius: number; fade: number }[] = [];
				if (frame.pointerClicks != null && speed > 0 && width > 0) {
					for (const click of frame.pointerClicks) {
						const age = frame.time - click.time;
						if (age <= 0 || age >= duration) continue;
						// 最初の1/4は波を保ち、その後は寿命の終端で勾配もゼロになるように減衰させる。
						const fadeProgress = Math.max(0, (age / duration - 0.25) / 0.75);
						const fade = 1 - fadeProgress ** 2 * (3 - 2 * fadeProgress);
						ripples.push({ center: click.position, radius: speed * age, fade });
						if (ripples.length === MAX_ACTIVE_RIPPLES) break;
					}
				}
				uniformValues.set({
					ripples,
					rippleCount: ripples.length,
					halfExtent,
					wavelength: Math.max(0.001, inputs.wavelength.value),
					width,
					strength: Math.max(0, inputs.strength.value),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				fullscreen.render(frame);
			},
			dispose: fullscreen.dispose,
		};
	},
};

export default implementation;
