import colorCode from './color.wgsl?raw';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { MAXIMUM_MAGNET_COUNT, MAGNETIC_PENDULUM_MINIMUM_ZOOM } from './_def_.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import { getMagneticPendulumMaximumSteps, getMagneticPendulumRenderWorkloadHint } from './render-workload.ts';
import type definition from './_def_.ts';

// 公開座標の0.25を内部モデルの長さ1に対応させる。磁石の既定配置を半径1で計算しつつ、
// UIの位置・高さ・速度は他のエフェクトと同じ長辺全体=1の共通単位で扱う。
const SIMULATION_UNITS_PER_SPATIAL_UNIT = 4;

const implementation: NativeEffectImplementation<typeof definition.paramDefs, 'unconvergedColor' | 'settlingShading'> = {
	async init(context) {
		const { device, resolution, inputs, outputTextures } = context;
		// 未使用の出力があってもWGSLのlocation順を保つ。複数の出力で一度の積分結果を共有する。
		const outputPorts = ['output', 'basinValue', 'settlingTime', 'convergedMask', 'travelDistance'];
		const usedPorts = outputPorts.filter(port => outputTextures.has(port));
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		// 1磁石をvec4f(position.xy, strength, heightSquared)で格納し、CPUとGPUのalignmentを揃える。
		// 高さの二乗はCPUで計算し、従来の未使用成分へ格納して転送量とGPUの演算数を増やさない。
		const magnetValues = new Float32Array(MAXIMUM_MAGNET_COUNT * 4);
		const magnetBuffer = device.createBuffer({ size: magnetValues.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const basinValues = new Float32Array(MAXIMUM_MAGNET_COUNT);
		const basinValueBuffer = device.createBuffer({ size: basinValues.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const group = device.createBindGroup({ layout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: magnetBuffer } },
			{ binding: 2, resource: { buffer: basinValueBuffer } },
		] });

		const spatialHalfExtent = getSpatialHalfExtent(resolution).map(value => value * SIMULATION_UNITS_PER_SPATIAL_UNIT);
		const rendersColor = outputTextures.has('output');
		const physicsInputs = { damping: 'scalar', restoringStrength: 'scalar' } as const;
		const physicsBindings = { damping: inputs.damping, restoringStrength: inputs.restoringStrength };
		const shaderInputs = rendersColor ? {
			...physicsBindings, unconvergedColor: inputs.unconvergedColor!,
			magnetColors: { kind: 'array' as const, elements: inputs.magnets.elements.map(magnet => magnet.fields.color) },
		} : physicsBindings;
		const operation = await createFullscreenEffect(context, {
			code: code + '\n' + (rendersColor ? colorCode : 'fn pendulumColor(simulation: PendulumSimulationResult, position: vec2f) -> vec4f { return vec4f(0); }'),
			outputPorts,
			schema: rendersColor ? { ...physicsInputs, magnetColors: { array: 'color' }, unconvergedColor: 'color' } : physicsInputs,
			inputs: shaderInputs,
			// Travel Distanceを使わない場合は、積分ステップごとの距離計算をpipeline定数で省く。
			constants: { MAGNET_COUNT: inputs.magnets.elements.length, CALCULATE_SCALARS: Number(usedPorts.some(port => port !== 'output')),
				CALCULATE_TRAVEL_DISTANCE: Number(outputTextures.has('travelDistance')) },
			// 収束先や終了ステップは画素ごとに異なるため、配色用の入力もLODを明示して読む。
			sampling: 'level0', internalLayouts: [layout],
			bindResources(pass) {
				for (const [index, magnet] of inputs.magnets.elements.entries()) {
					const magnetHeight = Math.max(0.005, magnet.fields.height.value) * SIMULATION_UNITS_PER_SPATIAL_UNIT;
					magnetValues.set([
						magnet.fields.position.value[0] * SIMULATION_UNITS_PER_SPATIAL_UNIT,
						magnet.fields.position.value[1] * SIMULATION_UNITS_PER_SPATIAL_UNIT,
						Math.max(0, magnet.fields.strength.value),
						magnetHeight * magnetHeight,
					], index * 4);
					basinValues[index] = magnet.fields.value.value;
				}
				const captureRadius = Math.max(0.001, inputs.captureRadius.value) * SIMULATION_UNITS_PER_SPATIAL_UNIT;
				const captureSpeed = Math.max(0, inputs.captureSpeed.value) * SIMULATION_UNITS_PER_SPATIAL_UNIT;
				uniformValues.set({
					spatialHalfExtent,
					viewCenter: inputs.view.fields.center.value.map(value => value * SIMULATION_UNITS_PER_SPATIAL_UNIT),
					initialVelocity: inputs.initialVelocity.value.map(value => value * SIMULATION_UNITS_PER_SPATIAL_UNIT),
					zoom: Math.max(MAGNETIC_PENDULUM_MINIMUM_ZOOM, inputs.view.fields.zoom.value),
					timeStep: Math.min(0.1, Math.max(0.001, inputs.timeStep.value)),
					captureRadiusSquared: captureRadius * captureRadius,
					captureSpeedSquared: captureSpeed * captureSpeed,
					settlingShading: rendersColor ? Math.min(1, Math.max(0, inputs.settlingShading!.value)) : 0,
					maximumSteps: getMagneticPendulumMaximumSteps(inputs.maximumSteps.value),
					antialiasing: inputs.antialiasing.value ? 1 : 0,
					unconvergedValue: inputs.unconvergedValue.value,
					travelDistanceScale: 1 / SIMULATION_UNITS_PER_SPATIAL_UNIT,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				device.queue.writeBuffer(magnetBuffer, 0, magnetValues);
				device.queue.writeBuffer(basinValueBuffer, 0, basinValues);
				pass.setBindGroup(0, group);
			},
			disposeResources() {
				uniformBuffer.destroy();
				magnetBuffer.destroy();
				basinValueBuffer.destroy();
			},
		});
		return { ...operation, getRenderWorkloadHint: () => getMagneticPendulumRenderWorkloadHint(inputs, usedPorts) };
	},
};

export default implementation;
