import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

function randomValue(cell: number, seed: number): number {
	let bits = (cell | 0) ^ seed;
	bits = Math.imul(bits ^ (bits >>> 16), 0x7feb352d);
	bits = Math.imul(bits ^ (bits >>> 15), 0x846ca68b);
	return ((bits ^ (bits >>> 16)) >>> 0) / 0x100000000;
}

function phaseNoise(time: number, seed: number): number {
	const cell = Math.floor(time);
	const fraction = time - cell;
	// 格子境界で速度・加速度が連続になる補間。逆再生や任意時刻へのシークにも状態を持たない。
	const weight = fraction ** 3 * (fraction * (fraction * 6 - 15) + 10);
	const start = randomValue(cell, seed);
	return start + (randomValue(cell + 1, seed) - start) * weight;
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });

		// uniform配列の16byte strideに合わせ、xyだけ使うvec4を15層分用意する。
		const phases = new Float32Array(15 * 4);
		return createFullscreenEffect(context, {
			code,
			schema: { background: 'color', colorFront: 'color', colorMid: 'color' },
			inputs,
			internalLayouts: [layout],
			bindResources(pass) {
				const extent = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				const time = inputs.time.value;
				const fullTurn = 2 * Math.PI;
				for (let layer = 0; layer < 15; layer++) {
					for (let axis = 0; axis < 2; axis++) {
						const seed = Math.imul(layer * 2 + axis + 1, 0x9e3779b9);
						// 元は全層がtime*0.5だけ進むため、time=4πで完全に同じ形へ戻る。
						// 時間を折り返さないノイズを層・軸ごとに加え、相対位相そのものを変化させる。
						// time=0では補正を0にし、元の初期形状を保つ。
						const evolution = phaseNoise(time * 0.15, seed) - phaseNoise(0, seed);
						// 全画素で共通の計算をCPUで行う。f32へ変換する前に三角関数の位相だけを
						// 小さく保ち、長時間再生で時間の量子化が目立つのを抑える。
						phases[layer * 4 + axis] = ((time * 0.5) % fullTurn + fullTurn * evolution) % fullTurn;
					}
				}
				uniformValues.set({
					coordinateScale: [resolution.width / extent, resolution.height / extent],
					offset: spatialToNormalizedCoordinates(inputs.offset.value, resolution),
					density: Math.max(1, inputs.density.value),
					angle: inputs.angle.value * fullTurn,
					brightness: Math.max(0, Math.min(1, inputs.brightness.value)),
					contrast: Math.max(0, Math.min(1, inputs.contrast.value)),
					phases,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
