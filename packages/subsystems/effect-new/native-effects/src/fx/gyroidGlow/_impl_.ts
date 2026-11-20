import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { createFullscreenEffect } from '../../fullscreen-effect.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

function finiteValue(value: number, fallback: number): number {
	return Number.isFinite(Math.fround(value)) ? value : fallback;
}

function boundedValue(value: number, minimum: number, maximum: number, fallback: number): number {
	return Math.min(maximum, Math.max(minimum, finiteValue(value, fallback)));
}

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(context) {
		const { device, resolution, inputs } = context;
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const colorRamp = createColorRampBindings(device, 1);
		uniformValues.set({
			viewHalfExtent: getSpatialHalfExtent(resolution),
		});
		return createFullscreenEffect(context, {
			code: colorRamp.shaderCode + '\n' + code,
			schema: { orbColor: 'color' },
			inputs,
			internalLayouts: [uniformLayout, colorRamp.layout],
			bindResources(pass) {
				const time = finiteValue(inputs.time.value, 0);
				const fullTurn = 2 * Math.PI;
				// 画面全体で同じ軌道と回転はCPUで計算する。Timeは絶対時刻として扱い、
				// 描画履歴やctx.timeDeltaを使わず、逆再生・任意時刻へのシークを再現可能にする。
				uniformValues.set({
					cameraPosition: [
						boundedValue(inputs.cameraPosition.value[0], -1000, 1000, 0),
						boundedValue(inputs.cameraPosition.value[1], -1000, 1000, 0),
						boundedValue(inputs.cameraZ.value, -1000, 1000, 0.8),
					],
					zoom: boundedValue(inputs.zoom.value, 0.01, 100, 1),
					rotation: (finiteValue(inputs.rotation.value, 0) % 1) * fullTurn,
					nearEmissionFadeDistance: boundedValue(inputs.nearEmissionFadeDistance.value, 0, 1000, 0),
					nearFoldFadeDistance: boundedValue(inputs.nearFoldFadeDistance.value, 0, 1000, 1),
					foldFrequency: boundedValue(inputs.foldFrequency.value, 0.01, 16, 1),
					foldAmount: boundedValue(inputs.foldAmount.value, 0, 16, 1),
					sheetTilt: [boundedValue(inputs.sheetTilt.value[0], -16, 16, 0.3), boundedValue(inputs.sheetTilt.value[1], -16, 16, 0.9)],
					glowWidth: boundedValue(inputs.glowWidth.value, 0, 100, 1),
					flowOffset: [0, time * 0.2, time * 0.6],
					spin: (time * 0.03 + 0.3) % fullTurn,
					orbPosition: [0.55 * Math.sin(time * 0.21), 0.25 * Math.cos(time * 0.17) + 0.225, -0.4 - 0.2 * Math.sin(time * 0.13)],
					sheetStrength: boundedValue(inputs.sheetStrength.value, 0, 1000, 1),
					orbStrength: boundedValue(inputs.orbStrength.value, 0, 1000, 1),
					colorPhase: finiteValue(inputs.colorPhase.value, 0) % 1,
					colorMode: inputs.colorMode.value === 'colorRamp' ? 1 : 0,
					colorFrequency: boundedValue(inputs.colorFrequency.value, 0, 100, 1),
					exposureMultiplier: 2 ** boundedValue(inputs.exposure.value, -20, 20, 0),
					softShoulder: inputs.toneMapping.value === 'softShoulder' ? 1 : 0,
					outputAlpha: inputs.compositing.value === 'opaque' ? 1 : 0,
					maximumSteps: Math.round(boundedValue(inputs.maximumSteps.value, 1, 2048, 120)),
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
