import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import seedrandom from 'seedrandom';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import code, { uniforms as codeUniforms } from './shader.shader.ts?shader';
import type definition from './_def_.ts';

// shader.wgslの分岐と対応する。方式やモードの変更ではpipelineを作り直さない。
const noiseTypes = { value: 0, simplex: 1, perlin: 2, worley: 3, flow: 4 } as const;
const fractalModes = { fbm: 0, turbulence: 1, ridged: 2, pingPong: 3 } as const;

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });

		let previousSeed: number | null = null;
		uniformValues.set({
			halfExtent: getSpatialHalfExtent(resolution),
		});
		return createFullscreenEffect(context, {
			code,
			schema: { coordinates: 'vector', density: 'vector', offset: 'vector', gain: 'scalar', lacunarity: 'scalar', pingPongStrength: 'scalar', flowStrength: 'scalar', outputMin: 'scalar', outputMax: 'scalar' },
			inputs,
			internalLayouts: [layout],
			sampling: 'level0',
			bindResources(pass) {
				if (inputs.seed.value !== previousSeed) {
					previousSeed = inputs.seed.value;
					// 大きなSeedもf32へ丸めずCPUで扱い、ノイズ座標は精度を保てる範囲に置く。
					const random = seedrandom(String(previousSeed));
					uniformValues.set({ seedOffset: [random() * 256, random() * 256, random() * 256] });
				}
				const referenceLength = getSizeReferenceLength(inputs.sizeReference.value, resolution);
				const rotation = inputs.octaveRotation.value * 2 * Math.PI;
				// f32へ変換する前に周期を折り返し、大きな位相でも小数部の精度を保つ。
				const flowPhase = inputs.flowPhase.value - Math.floor(inputs.flowPhase.value);
				const flowRotation = flowPhase * 2 * Math.PI;
				uniformValues.set({
					referenceScale: Math.max(resolution.width, resolution.height) / referenceLength,
					coordinateSource: inputs.coordinateSource.value === 'input' ? 1 : 0,
					noiseType: noiseTypes[inputs.noiseType.value],
					fractalMode: fractalModes[inputs.fractalMode.value],
					flowRotation: [Math.cos(flowRotation), Math.sin(flowRotation)],
					octaves: Number.isFinite(inputs.octaves.value) ? Math.min(16, Math.max(1, Math.round(inputs.octaves.value))) : 4,
					octaveRotation: [Math.cos(rotation), Math.sin(rotation)],
					time: inputs.time.value,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, group);
			},
			disposeResources() { uniformBuffer.destroy(); },
		});
	},
};

export default implementation;
