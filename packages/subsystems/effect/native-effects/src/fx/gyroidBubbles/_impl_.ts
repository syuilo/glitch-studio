import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import definition from './_def_.ts';
import code, { uniforms as shaderUniforms } from './shader.wgsl?shader';

const TAU = 2 * Math.PI;
const LOOP_SECONDS = 18;
// 奥行きと接近の位相をずらし、初期構図でも独立した泡と融合した泡が見えるようにする。
const bubblePairOrbits = [
	{ center: [0, 0.15, 0.015], angle: 0, phase: 0, radiusScales: [1, 0.93] },
	{ center: [-0.165, -0.135, -0.19], angle: 0.72, phase: 2.35, radiusScales: [0.8, 1.03] },
	{ center: [0.24, -0.125, -0.35], angle: -0.75, phase: 4.4, radiusScales: [1.13, 0.68] },
	{ center: [-0.36, 0.17, -0.44], angle: 1.33, phase: 1.7, radiusScales: [0.72, 0.92] },
	{ center: [0.39, 0.22, -0.55], angle: 0.53, phase: 3.4, radiusScales: [0.91, 0.77] },
	{ center: [0.07, -0.24, -0.66], angle: -0.38, phase: 5.5, radiusScales: [0.99, 0.89] },
];

function boundedValue(value: number, minimum: number, maximum: number, fallback: number): number {
	return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function wrappedPhase(value: number, period: number): number {
	const remainder = Number.isFinite(value) ? value % period : 0;
	return remainder < 0 ? (remainder + period) / period : remainder / period;
}

function getBubbleScene(phase: number, count: number, radius: number, spacing: number, padding: number) {
	const bubbles: [number, number, number, number][] = [];
	const centerSum = [0, 0, 0];
	for (let bubbleIndex = 0; bubbleIndex < count; bubbleIndex++) {
		const orbit = bubblePairOrbits[Math.floor(bubbleIndex / 2)];
		const side = bubbleIndex % 2;
		const direction = 2 * side - 1;
		const pairPhase = phase + orbit.phase;
		const pairAngle = orbit.angle + 0.28 * Math.sin(pairPhase);
		const pairSpacing = 0.3 + 0.105 * Math.sin(pairPhase);
		const offset = direction * pairSpacing * 0.5;
		const center = [
			orbit.center[0] + 0.045 * Math.sin(pairPhase) + offset * Math.cos(pairAngle),
			orbit.center[1] + 0.034 * Math.sin(2 * pairPhase) + offset * Math.sin(pairAngle),
			orbit.center[2] + 0.045 * Math.sin(pairPhase) + direction * 0.07 * Math.sin(pairPhase),
		];
		const bubbleRadius = radius * orbit.radiusScales[side];
		bubbles.push([center[0], center[1], center[2], bubbleRadius]);
		for (let axis = 0; axis < 3; axis++) {
			centerSum[axis] += center[axis];
		}
	}
	// 全体の平均位置を支点にすると、間隔を変えても構図全体が移動せず、1個だけの泡もその場に留まる。
	const centroid = centerSum.map(sum => sum / count);
	const boundsMin = [Infinity, Infinity, Infinity];
	const boundsMax = [-Infinity, -Infinity, -Infinity];
	for (const bubble of bubbles) {
		const bubbleRadius = bubble[3];
		for (let axis = 0; axis < 3; axis++) {
			const centerCoordinate = bubble[axis] + (bubble[axis] - centroid[axis]) * (spacing - 1);
			bubble[axis] = centerCoordinate;
			boundsMin[axis] = Math.min(boundsMin[axis], centerCoordinate - bubbleRadius - padding);
			boundsMax[axis] = Math.max(boundsMax[axis], centerCoordinate + bubbleRadius + padding);
		}
	}
	return { bubbles, boundsMin, boundsMax };
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const defaults = definition.paramDefs;
		const uniformValues = createShaderBuffer(shaderUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);
		uniformValues.set({ viewHalfExtent: getSpatialHalfExtent(resolution) });
		return createFullscreenEffect(context, {
			code: colorRamp.shaderCode + '\n' + code,
			schema: {},
			inputs,
			internalLayouts: [uniformLayout, colorRamp.layout],
			bindResources(pass) {
				const phase = wrappedPhase(inputs.time.value, LOOP_SECONDS) * TAU;
				const count = Math.round(boundedValue(inputs.count.value, 1, bubblePairOrbits.length * 2, defaults.count.defaultValue));
				const radius = boundedValue(inputs.radius.value, 0.02, 0.5, defaults.radius.defaultValue);
				const spacing = boundedValue(inputs.spacing.value, 0, 3, defaults.spacing.defaultValue);
				const mergeWidth = boundedValue(inputs.mergeWidth.value, 0, 0.3, defaults.mergeWidth.defaultValue);
				const deformationAmplitude = radius * 0.35 * boundedValue(inputs.surfaceDeformation.value, 0, 1, defaults.surfaceDeformation.defaultValue);
				const deformationFrequency = 5 / radius * boundedValue(inputs.detailFrequency.value, 0.25, 4, defaults.detailFrequency.defaultValue);
				const glowWidth = boundedValue(inputs.glowWidth.value, 0, 0.1, defaults.glowWidth.defaultValue);
				const effectiveGlowWidth = glowWidth > 0 ? Math.max(0.001, glowWidth) : 0;
				// smooth minimumは1回につき最大でMerge Widthの1/4だけ距離を減らす。
				// 膜のうねりと発光幅も加えて、融合部や輪郭の光を境界ボックスで切らないようにする。
				const padding = (count - 1) * mergeWidth * 0.25 + deformationAmplitude + effectiveGlowWidth;
				uniformValues.set({
					...getBubbleScene(phase, count, radius, spacing, padding),
					bubbleCount: count,
					mergeWidth,
					deformationAmplitude,
					deformationFrequency,
					flowPhase: phase,
					// smooth minimumの勾配は各距離の勾配の凸結合。gyroidの各偏微分は最大2/3なので、
					// 変形を加えた場の変化率は 1 + (2 / sqrt(3)) * amplitude * frequency 以下になる。
					inverseFieldSlopeBound: 1 / (1 + (2 / Math.sqrt(3)) * deformationAmplitude * deformationFrequency),
					glowWidth: effectiveGlowWidth,
					glowStrength: boundedValue(inputs.glowStrength.value, 0, 1000, defaults.glowStrength.defaultValue),
					cameraPosition: [
						boundedValue(inputs.cameraPosition.value[0], -1000, 1000, 0),
						boundedValue(inputs.cameraPosition.value[1], -1000, 1000, 0),
						boundedValue(inputs.cameraZ.value, -1000, 1000, defaults.cameraZ.defaultValue),
					],
					zoom: boundedValue(inputs.zoom.value, 0.01, 100, defaults.zoom.defaultValue),
					rotation: wrappedPhase(inputs.rotation.value, 1) * TAU,
					colorMode: Number(inputs.colorMode.value === 'colorRamp'),
					colorFrequency: boundedValue(inputs.colorFrequency.value, 0, 100, defaults.colorFrequency.defaultValue),
					colorPhase: wrappedPhase(inputs.colorPhase.value, 1),
					exposureMultiplier: 2 ** boundedValue(inputs.exposure.value, -20, 20, defaults.exposure.defaultValue),
					softShoulder: Number(inputs.toneMapping.value === 'softShoulder'),
					outputAlpha: Number(inputs.compositing.value === 'opaque'),
					maximumSteps: Math.round(boundedValue(inputs.maximumSteps.value, 1, 1024, defaults.maximumSteps.defaultValue)),
					maximumTraceDistance: boundedValue(inputs.maximumTraceDistance.value, 0, 1000, defaults.maximumTraceDistance.defaultValue),
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				pass.setBindGroup(0, uniformGroup);
				pass.setBindGroup(1, colorRamp.update(inputs.ramp.value));
			},
			disposeResources() {
				colorRamp.dispose();
				uniformBuffer.destroy();
			},
		});
	},
};

export default implementation;
