import { createShaderBuffer } from '@gs/shared/gpu/shader-buffer.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createColorRampBindings } from '@gs/shared/gpu/color-ramp.ts';
import { getSpatialHalfExtent } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import { bindParameterValues } from '../../multipass.ts';
import colorCode from './color.wgsl?raw';
import shaderCode, { uniforms as shaderCodeUniforms } from './shader.shader.ts?shader';
import { getMandelbrotIterationCount, getMandelbrotSettings } from './mandelbrot-settings.ts';
import { buildMandelbrotReferenceOrbit } from './reference-orbit.ts';
import { packMandelbrotNumber } from './extended-precision.ts';
import { createFixedInputBindings } from '../../shader-input.ts';
import type definition from './_def_.ts';

const coloringMethods = { escapeIterations: 0, smoothEscapeIterations: 1, triangleInequalityAverage: 2 } as const;

const implementation: NativeEffectImplementation<typeof definition.paramDefs,
	'coloringMethod' | 'ramp' | 'iterationColorPeriod' | 'triangleColorDensity' | 'colorPhase' | 'unescapedColor'> = {
	createOutputTexture(id, resolution, { device, enable32bitDataTextures }) {
		const format = id === 'output' ? INTERMEDIATE_TEXTURE_FORMAT
			: enable32bitDataTextures || id === 'escapeIterations' || id === 'smoothIterations' ? 'r32float' : 'r16float';
		return device.createTexture({ size: resolution, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
	},
	init(placement) {
		const { device, defaultVertexShaderModule, resolution, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const uniformValues = createShaderBuffer(shaderCodeUniforms.uniforms);
		const uniformBuffer = device.createBuffer({ size: uniformValues.arrayBuffer.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
		] });
		const outputs = ['output', 'escapeIterations', 'smoothIterations', 'escapedMask', 'triangleInequalityAverage'].map(id => outputTextures.get(id));
		const targets = outputs.map(texture => texture == null ? null : { format: texture.format });
		const descriptor: GPURenderPassDescriptor = { colorAttachments: outputs.map(texture => texture == null ? null : {
			view: texture.createView(), loadOp: 'clear', storeOp: 'store',
		}) };
		// 数値だけを使う配置から彩色用の上流ノード・Ramp・GPU bindingをまとめて省く。
		const colorRamp = outputs[0] == null ? null : createColorRampBindings(device, 1);
		const inputGroup = colorRamp == null ? 1 : 2;
		const bindings = colorRamp == null
			? createFixedInputBindings(device, { coordinateOffset: 'vector' }, params, resolution, inputGroup, 'level0')
			: createFixedInputBindings(device, { coordinateOffset: 'vector', unescapedColor: 'color' },
				{ coordinateOffset: params.coordinateOffset, unescapedColor: params.unescapedColor! }, resolution, inputGroup, 'level0');
		const coloring = colorRamp == null ? 'fn colorMandelbrotSample(orbit: MandelbrotOrbit, position: vec2f) -> vec4f { return vec4f(0.0); }' : colorCode;
		const module = device.createShaderModule({ code: [bindings.code, colorRamp?.shaderCode, shaderCode, coloring].join('\n') });
		const layouts = colorRamp == null ? [layout, bindings.layout] : [layout, colorRamp.layout, bindings.layout];
		const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: layouts });
		const pipelines = [false, true].map(perturbation => device.createRenderPipeline({
			layout: pipelineLayout, vertex: { module: defaultVertexShaderModule },
			fragment: { module, targets, constants: { USE_PERTURBATION: Number(perturbation), RENDER_COLOR: Number(outputs[0] != null),
				CALCULATE_SMOOTH_ITERATIONS: Number(outputs[2] != null), CALCULATE_TRIANGLE_AVERAGE: Number(outputs[4] != null) } },
		}));
		const spatialHalfExtent = getSpatialHalfExtent(resolution);
		const longSide = Math.max(resolution.width, resolution.height);
		const activePorts = [...outputTextures.keys()].sort();
		type Reference = { buffer: GPUBuffer; group: GPUBindGroup; center: readonly [number, number] };
		const references = new Map<string, Reference>();
		let reference: Reference;
		let settings: ReturnType<typeof getMandelbrotSettings>;

		return {
			cacheKey: 0,
			getRenderWorkloadHint() {
				if (params.coordinateOffset.kind !== 'uniform') return null;
				return {
					workPerPixel: getMandelbrotIterationCount(params.maximumIterations) * (params.antialiasing ? 4 : 1),
					key: JSON.stringify([params.referenceCenter, params.view, params.coordinateOffset.value, params.bailoutRadius,
						params.coloringMethod, params.unescapedColor?.kind, params.ramp?.stops.length,
						params.ramp?.interpolation, params.ramp?.colorSpace, activePorts]),
				};
			},
			prepare(_frame, signal) {
				settings = getMandelbrotSettings(params.view, params.maximumIterations, params.bailoutRadius, longSide);
				const request = { center: [params.referenceCenter.real, params.referenceCenter.imaginary] as const,
					centerOffset: params.view.center, precisionBits: settings.precisionBits, maximumIterations: settings.maximumIterations,
					bailoutRadius: settings.bailoutRadius, usePerturbation: settings.usePerturbation };
				const key = JSON.stringify(request);
				const cached = references.get(key);
				if (cached != null) {
					if (reference !== cached) {
						references.delete(key);
						references.set(key, cached);
						reference = cached;
					}
					return;
				}
				return buildMandelbrotReferenceOrbit(request, signal).then(orbit => {
					signal.throwIfAborted();
					const buffer = device.createBuffer({ size: orbit.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
					device.queue.writeBuffer(buffer, 0, orbit.data);
					const group = device.createBindGroup({ layout, entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer } },
					] });
					reference = { buffer, group, center: orbit.center };
					references.set(key, reference);
					if (references.size > 2) {
						const oldest = references.keys().next().value!;
						references.get(oldest)!.buffer.destroy();
						references.delete(oldest);
					}
				});
			},
			render(ctx) {
				const coloringMethod = coloringMethods[params.coloringMethod ?? 'escapeIterations'];
				// 反復前の|z|をこの半径以下に抑える。二乗後の最大1e24もf32に収まり、
				// さらに二乗ノルムを求めないことで、発散判定自体のオーバーフローを避ける。
				const bailoutRadius = settings.bailoutRadius;
				const phase = params.colorPhase ?? 0;
				const rotation = params.view.rotation * Math.PI * 2;
				uniformValues.set({
					spatialHalfExtent,
					resolution: [resolution.width, resolution.height],
					pixelStep: [2 / resolution.width, 2 / resolution.height],
					complexCenter: reference.center, coloringMethod,
					rotation: { real: packMandelbrotNumber(Math.cos(rotation)), imaginary: packMandelbrotNumber(Math.sin(rotation)) },
					rotationFloat: [Math.cos(rotation), Math.sin(rotation)],
					// 長辺全体=1の画面座標を、Zoom=1で複素平面の長さ4へ対応させる。
					complexScale: packMandelbrotNumber(settings.complexScale),
					pixelScale: packMandelbrotNumber(settings.complexScale / longSide),
					complexScaleFloat: settings.usePerturbation ? 0 : settings.complexScale,
					maximumIterations: settings.maximumIterations,
					bailoutRadius,
					log2LogBailoutRadius: Math.log2(Math.log(bailoutRadius)),
					iterationColorPeriod: Math.max(0.001, params.iterationColorPeriod ?? 1),
					triangleColorDensity: Math.max(0, params.triangleColorDensity ?? 0),
					colorPhase: phase - Math.floor(phase),
					antialiasing: params.antialiasing ? 1 : 0,
				});
				device.queue.writeBuffer(uniformBuffer, 0, uniformValues.arrayBuffer);
				const pass = ctx.commandEncoder.beginRenderPass(descriptor);
				pass.setPipeline(pipelines[Number(settings.usePerturbation)]);
				pass.setBindGroup(0, reference.group);
				if (colorRamp != null) pass.setBindGroup(1, colorRamp.update(params.ramp!));
				pass.setBindGroup(inputGroup, bindings.getBindGroup());
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				for (const { buffer } of references.values()) buffer.destroy();
				bindings.dispose();
				colorRamp?.dispose();
				uniformBuffer.destroy();
			},
		};
	},
};

export default implementation;
