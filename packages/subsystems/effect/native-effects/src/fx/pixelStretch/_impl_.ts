import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, inputs, resolution } = context;
		const halfExtent = getSpatialHalfExtent(resolution);
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		uniformValues.set({ halfExtent, sampleLimit: [1 - 1 / resolution.width, 1 - 1 / resolution.height] });
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		return createFullscreenEffect(context, {
			code,
			schema: { input: 'color' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				const angle = (inputs.angle.value % 1) * (2 * Math.PI);
				const sine = Math.sin(angle);
				const cosine = Math.cos(angle);
				// 直角での丸め誤差を除き、Position=1でも画面端の1辺全体を境界にする。
				const boundaryNormal = [Math.abs(sine) < Number.EPSILON ? 0 : sine, Math.abs(cosine) < Number.EPSILON ? 0 : cosine] as const;
				const tangent = [-boundaryNormal[1], boundaryNormal[0]] as const;
				const leadingPoint = [Math.sign(boundaryNormal[0]) * halfExtent[0], Math.sign(boundaryNormal[1]) * halfExtent[1]] as const;
				const projectionExtent = leadingPoint[0] * boundaryNormal[0] + leadingPoint[1] * boundaryNormal[1];
				const position = Math.min(1, Math.max(0, inputs.position.value));
				// 進行方向の最前端から引くと、Position=1で斜めの線分の端点が角に正確に一致する。
				const distanceFromLeadingPoint = (1 - position) * 2 * projectionExtent;
				const boundaryAnchor = [
					leadingPoint[0] - distanceFromLeadingPoint * boundaryNormal[0],
					leadingPoint[1] - distanceFromLeadingPoint * boundaryNormal[1],
				] as const;
				// 境界上の点を anchor + tangent * distance と置き、X/Yそれぞれで画面内に残る範囲を交差させる。
				// 線分の端点はフレーム内で共通なので、範囲の計算はCPUで一度だけ行う。
				let tangentMinimum = -Infinity;
				let tangentMaximum = Infinity;
				for (const axis of [0, 1] as const) {
					if (tangent[axis] === 0) continue;
					const negativeEdge = (-halfExtent[axis] - boundaryAnchor[axis]) / tangent[axis];
					const positiveEdge = (halfExtent[axis] - boundaryAnchor[axis]) / tangent[axis];
					tangentMinimum = Math.max(tangentMinimum, Math.min(negativeEdge, positiveEdge));
					tangentMaximum = Math.min(tangentMaximum, Math.max(negativeEdge, positiveEdge));
				}
				// 線分が角の一点に縮む付近でも、丸め誤差でclampの上下限が逆転しないようにする。
				uniformValues.set({
					boundaryNormal: [...boundaryNormal],
					boundaryAnchor: [...boundaryAnchor],
					tangentRange: [tangentMinimum, Math.max(tangentMinimum, tangentMaximum)],
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, bindGroup);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
