import colorCode from './color.wgsl?raw';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import { createIntegrationSchedule } from './integration-schedule.ts';
import { getDoublePendulumFractalRenderWorkloadHint } from './render-workload.ts';
import { DOUBLE_PENDULUM_FRACTAL_SPAN_AT_ZOOM_ONE } from './_def_.ts';
import code, { uniforms as codeUniforms } from './shader.wgsl?shader';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs, 'ramp' | 'coloringMethod' | 'angularVelocityRange'> = {
	async init(context) {
		const { device, resolution, inputs, outputTextures } = context;
		const outputPorts = ['output', 'angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'];
		const usedPorts = outputPorts.filter(port => outputTextures.has(port));
		const uniformValues = createShaderBuffer(codeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
		const uniformGroup = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
		const rendersColor = outputTextures.has('output');
		const colorRamp = rendersColor ? createColorRampBindings(device, 1) : null;
		const colorShader = colorRamp == null ? 'fn pendulumColor(state: vec4f) -> vec4f { return vec4f(0); }' : colorRamp.shaderCode + '\n' + colorCode;
		const shader = device.createShaderModule({ code: colorShader + '\n' + code });
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: colorRamp == null ? [uniformLayout] : [uniformLayout, colorRamp.layout] });
		const spatialHalfExtent = getSpatialHalfExtent(resolution);
		const wrapAngle = (angle: number) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

		// 未使用のattachmentを省いてもWGSLのlocation順を保つ。各出力は同じ積分結果を共有する。
		const outputs = outputPorts.map(port => outputTextures.get(port));
		const descriptor: GPURenderPassDescriptor = { colorAttachments: outputs.map(texture => texture == null ? null
			: { view: texture.createView(), loadOp: 'clear', storeOp: 'store' }) };

		function dispose() {
			uniformBuffer.destroy();
			colorRamp?.dispose();
		}

		let pipeline: GPURenderPipeline;
		try {
			pipeline = await device.createRenderPipelineAsync({
				layout: pipelineLayout, vertex: { module: context.defaultVertexShaderModule },
				fragment: { module: shader,
					targets: outputs.map(texture => texture == null ? null : { format: texture.format }) },
			});
		} catch (error) {
			dispose();
			throw error;
		}
		return {
			cacheKey: 0,
			getRenderWorkloadHint: () => getDoublePendulumFractalRenderWorkloadHint(inputs, usedPorts),
			render({ commandEncoder }) {
				const schedule = createIntegrationSchedule(inputs.simulationTime.value, inputs.timeStep.value);
				for (const name of ['initialAngularVelocity1', 'initialAngularVelocity2', 'lengthRatio', 'massRatio', 'gravity'] as const) {
					if (!Number.isFinite(Math.fround(inputs[name].value))) throw new Error(`Double Pendulum Fractal requires a finite ${name} representable as f32.`);
				}
				if (!inputs.view.fields.center.value.every(value => Number.isFinite(Math.fround(value)))) throw new Error('Double Pendulum Fractal requires a finite View Center representable as f32.');
				if (!Number.isFinite(Math.fround(inputs.view.fields.zoom.value)) || Math.fround(inputs.view.fields.zoom.value) <= 0) throw new Error('Double Pendulum Fractal requires a positive View Zoom representable as f32.');
				for (const name of ['lengthRatio', 'massRatio'] as const) {
					if (Math.fround(inputs[name].value) <= 0) throw new Error(`Double Pendulum Fractal requires a positive ${name}.`);
				}
				const angularVelocityRange = rendersColor ? inputs.angularVelocityRange!.value : 1;
				if (!Number.isFinite(Math.fround(angularVelocityRange)) || Math.fround(angularVelocityRange) <= 0) throw new Error('Double Pendulum Fractal requires a finite positive angularVelocityRange representable as f32.');
				const coloringMethod = !rendersColor ? 0 : ['sphericalRgb', 'angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'].indexOf(inputs.coloringMethod!.value);
				uniformValues.set({
					coloringMethod,
					spatialHalfExtent,
					pixelStep: [2 / resolution.width, 2 / resolution.height],
					// 元の画像は下向きにtheta2が増える。Viewは上向きが+Yなので中心も
					// 逆符号へ換算し、既存の模様の向きとカーソル基準の操作を両立する。
					angleCenter: [wrapAngle(inputs.view.fields.center.value[0]), wrapAngle(-inputs.view.fields.center.value[1])],
					initialAngularVelocity: [inputs.initialAngularVelocity1.value, inputs.initialAngularVelocity2.value],
					angleScale: DOUBLE_PENDULUM_FRACTAL_SPAN_AT_ZOOM_ONE / inputs.view.fields.zoom.value,
					lengthRatio: inputs.lengthRatio.value,
					massFraction: inputs.massRatio.value / (1 + inputs.massRatio.value),
					inverseTotalMass: 1 / (1 + inputs.massRatio.value),
					gravity: inputs.gravity.value,
					timeStep: inputs.timeStep.value,
					fullSteps: schedule.fullSteps,
					remainder: schedule.remainder,
					angularVelocityRange,
					antialiasing: inputs.antialiasing.value ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const rampGroup = colorRamp?.update(inputs.ramp!.value);
				const pass = commandEncoder.beginRenderPass(descriptor);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, uniformGroup);
				if (rampGroup != null) pass.setBindGroup(1, rampGroup);
				pass.draw(3);
				pass.end();
			},
			dispose,
		};
	},
};

export default implementation;
