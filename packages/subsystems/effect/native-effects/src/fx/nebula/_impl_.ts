import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import seedrandom from 'seedrandom';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

function boundedValue(value: number, minimum: number, maximum: number, fallback: number): number {
	return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);

		let previousSeed: number | null = null;
		uniformValues.set({
			viewHalfExtent: getSpatialHalfExtent(resolution),
		});
		return createFullscreenEffect(context, {
			code: colorRamp.shaderCode + '\n' + code,
			schema: {},
			inputs,
			internalLayouts: [uniformLayout, colorRamp.layout],
			bindResources(pass) {
				const seed = Number.isFinite(inputs.seed.value) ? inputs.seed.value : 0;
				if (previousSeed !== seed) {
					// Seedはf32へ丸めずCPUで扱う。描画順やフレームごとの乱数に依存させない。
					const random = seedrandom(String(seed));
					uniformValues.set({ seedOffset: [random() * 256, random() * 256, random() * 256] });
					previousSeed = seed;
				}
				const time = boundedValue(inputs.time.value, -1e9, 1e9, 0);
				const noiseFrequency = boundedValue(inputs.noiseFrequency.value, 0.01, 64, 1.8);
				const rotation = Number.isFinite(inputs.rotation.value) ? inputs.rotation.value % 1 : 0;
				uniformValues.set({
					cameraPosition: [boundedValue(inputs.cameraPosition.value[0], -1000, 1000, 0), boundedValue(inputs.cameraPosition.value[1], -1000, 1000, 0), boundedValue(inputs.cameraZ.value, -1000, 1000, 0.8)],
					center: [boundedValue(inputs.center.value[0], -1000, 1000, 0), boundedValue(inputs.center.value[1], -1000, 1000, 0), boundedValue(inputs.centerZ.value, -1000, 1000, -1.2)],
					zoom: boundedValue(inputs.zoom.value, 0.01, 100, 1),
					rotation: rotation * 2 * Math.PI,
					radius: boundedValue(inputs.radius.value, 0, 100, 1.5),
					density: boundedValue(inputs.density.value, 0, 100, 6),
					coverage: boundedValue(inputs.coverage.value, 0, 1, 0.3),
					noiseFrequency,
					octaves: Math.round(boundedValue(inputs.octaves.value, 1, 6, 5)),
					turbulence: boundedValue(inputs.turbulence.value, 0, 16, 1),
					// 256周期のノイズに合わせCPU側で折り返し、長時間の再生でも小数部を保つ。
					// 速度は共通単位/秒。ノイズ座標への換算はこの境界だけで行う。
					flowOffset: [
						time * boundedValue(inputs.flow.value[0], -10, 10, 0.04) * noiseFrequency % 256,
						time * boundedValue(inputs.flow.value[1], -10, 10, 0.02) * noiseFrequency % 256,
						time * boundedValue(inputs.flowZ.value, -10, 10, 0.02) * noiseFrequency % 256,
					],
					colorOffset: boundedValue(inputs.colorOffset.value, -1, 1, 0),
					emission: boundedValue(inputs.emission.value, 0, 1000, 4),
					absorption: boundedValue(inputs.absorption.value, 0, 100, 1.5),
					exposureMultiplier: 2 ** boundedValue(inputs.exposure.value, -20, 20, 0),
					softShoulder: inputs.toneMapping.value === 'softShoulder' ? 1 : 0,
					compositing: { volume: 0, opaque: 1, emission: 2 }[inputs.compositing.value],
					stepSize: boundedValue(inputs.stepSize.value, 0.0001, 1, 0.025),
					maximumSteps: Math.round(boundedValue(inputs.maximumSteps.value, 1, 2048, 192)),
					maximumTraceDistance: boundedValue(inputs.maximumTraceDistance.value, 0, 1000, 7),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampBindGroup = colorRamp.update(inputs.ramp.value);
				pass.setBindGroup(0, uniformGroup);
				pass.setBindGroup(1, rampBindGroup);
			},
			disposeResources() {
				colorRamp.dispose();
				uniformBuffer.destroy();
			},
		});
	},
};

export default implementation;
