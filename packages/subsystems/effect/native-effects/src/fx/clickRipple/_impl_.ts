import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import type definition from './_def_.ts';
import code, { uniforms } from './shader.wgsl?shader';

const MAX_ACTIVE_CLICKS = 16; // 押下1件につき最大9波源をshader.wgslのUniforms.ripplesへ渡す。

type Ripple = { center: readonly [number, number]; radius: number; fade: number };

function appendVisibleRipples(ripples: Ripple[], ripple: Ripple, halfExtent: readonly [number, number], width: number, reflectivity: number) {
	const [centerX, centerY] = ripple.center;
	const [halfWidth, halfHeight] = halfExtent;
	// 描画領域外の押下は直接波だけを扱う。外の押下を鏡写しにすると、壁に届く前に領域内で反射波が生まれてしまう。
	const reflects = reflectivity > 0 && Math.abs(centerX) <= halfWidth && Math.abs(centerY) <= halfHeight;
	const sourceXs = reflects ? [centerX, -2 * halfWidth - centerX, 2 * halfWidth - centerX] : [centerX];
	const sourceYs = reflects ? [centerY, -2 * halfHeight - centerY, 2 * halfHeight - centerY] : [centerY];
	const fadeByReflectionCount = [ripple.fade, ripple.fade * reflectivity, ripple.fade * reflectivity ** 2];
	const outerRadiusSquared = ripple.radius ** 2;
	const innerRadiusSquared = Math.max(0, ripple.radius - width) ** 2;
	for (const [yIndex, y] of sourceYs.entries()) {
		for (const [xIndex, x] of sourceXs.entries()) {
			// 波の帯が矩形と交差するときだけ波源を渡し、画素ごとに無関係な鏡像を評価するのを避ける。
			const distanceX = Math.abs(x);
			const distanceY = Math.abs(y);
			const nearestSquared = Math.max(0, distanceX - halfWidth) ** 2 + Math.max(0, distanceY - halfHeight) ** 2;
			const farthestSquared = (distanceX + halfWidth) ** 2 + (distanceY + halfHeight) ** 2;
			if (nearestSquared >= outerRadiusSquared || farthestSquared <= innerRadiusSquared) continue;
			const reflectionCount = Number(xIndex !== 0) + Number(yIndex !== 0);
			ripples.push({ center: [x, y], radius: ripple.radius, fade: fadeByReflectionCount[reflectionCount] });
		}
	}
}

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
				const reflectivity = Math.min(1, Math.max(0, inputs.reflectivity.value));
				const ripples: Ripple[] = [];
				let activeClickCount = 0;
				if (frame.pointerClicks != null && speed > 0 && width > 0) {
					for (const click of frame.pointerClicks) {
						const age = frame.time - click.time;
						if (age <= 0 || age >= duration) continue;
						// 最初の1/4は波を保ち、その後は寿命の終端で勾配もゼロになるように減衰させる。
						const fadeProgress = Math.max(0, (age / duration - 0.25) / 0.75);
						const fade = 1 - fadeProgress ** 2 * (3 - 2 * fadeProgress);
						appendVisibleRipples(ripples, { center: click.position, radius: speed * age, fade }, halfExtent, width, reflectivity);
						if (++activeClickCount === MAX_ACTIVE_CLICKS) break;
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
