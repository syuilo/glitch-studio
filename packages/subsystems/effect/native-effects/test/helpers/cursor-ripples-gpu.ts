import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { EffectFrameContext, EffectGpuContext } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import definition from '../../src/fx/cursorRipples/_def_.ts';
import implementation from '../../src/fx/cursorRipples/_impl_.ts';
import { nativeEffectProbe } from './native-effect-probe.ts';

const tick = 1 / 120;

function check(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}

async function createRipple(gpu: EffectGpuContext, width: number, height: number) {
	const probe = nativeEffectProbe(definition, implementation);
	const resolution = { width, height };
	const effect = await createEffectInstance({
		effectSource: { type: 'nativeEffect', id: 'cursorRipples' },
		definitions: { getNativeEffect: () => definition, getNodesEffect: () => null, getCustomShaderEffect: () => null },
		usedOutputPorts: new Set(['output']), resolution, inputs: {},
	}, gpu, () => ({ ...implementation, createOutputTexture: port => probe.createTexture(port, { wgpu: gpu, resolution }) }));
	return {
		reset: effect.resetRenderHistory,
		dispose: effect.dispose,
		async render(time: number, timeDelta: number, pointerStrokeSegments: EffectFrameContext['pointerStrokeSegments'] = []) {
			const { device, enable32bitDataTextures } = gpu;
			const encoder = device.createCommandEncoder();
			effect.render({ time, timeDelta, pointerStrokeSegments }, encoder);
			const bytesPerComponent = enable32bitDataTextures ? 4 : 2;
			const stride = Math.ceil(width * 2 * bytesPerComponent / 256) * 256;
			const buffer = device.createBuffer({ size: stride * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			try {
				encoder.copyTextureToBuffer({ texture: effect.outputs.get('output')!.texture }, { buffer, bytesPerRow: stride }, [width, height]);
				device.queue.submit([encoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const mapped = buffer.getMappedRange().slice(0);
				return enable32bitDataTextures ? new Float32Array(mapped) : new Float16Array(mapped);
			} finally { buffer.destroy(); }
		},
	};
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32 = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32 ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const gpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
	const ripple = await createRipple(gpu, 128, 72);
	const fastStroke = [{ start: [-0.42, 0], end: [0.42, 0], startTime: 0, endTime: tick }] as const;
	try {
		check((await ripple.render(0, 0)).every(value => value === 0), 'flat before moving');
		const first = await ripple.render(tick, tick * 1000, fastStroke);
		for (const x of [24, 48, 64, 80, 104]) {
			const up = first[(32 * 128 + x) * 2 + 1];
			const down = first[(39 * 128 + x) * 2 + 1];
			check(up > 0.001 && down < -0.001, `continuous signed displacement at ${x}: ${up}, ${down}`);
		}
		const advancing = await ripple.render(2 * tick, tick * 1000);
		check(advancing.some((value, index) => value !== first[index]), 'waves advance with a still pointer');
		const paused = await ripple.render(2 * tick, 0, fastStroke);
		check(paused.every((value, index) => value === advancing[index]), 'pausing holds the displacement');
		ripple.reset();
		check((await ripple.render(0, 0)).every(value => value === 0), 'restart clears the field');
		const entering = await ripple.render(tick, tick * 1000, [{ ...fastStroke[0], start: [-0.6, 0] }]);
		check(entering.every(value => value === 0), 'entering from outside does not create a wave');

		const singleFrameRipple = await createRipple(gpu, 128, 72);
		const splitFrameRipple = await createRipple(gpu, 128, 72);
		try {
			const turn = { start: fastStroke[0].end, end: [0.42, 0.2] as const, startTime: tick, endTime: 3 * tick };
			const at30Fps = await singleFrameRipple.render(4 * tick, 4 * tick * 1000, [...fastStroke, turn]);
			await splitFrameRipple.render(2 * tick, 2 * tick * 1000, fastStroke);
			const at60Fps = await splitFrameRipple.render(4 * tick, 2 * tick * 1000, [turn]);
			check(at30Fps.every((value, index) => value === at60Fps[index]), 'same input history at 30 FPS and 60 FPS');
		} finally { singleFrameRipple.dispose(); splitFrameRipple.dispose(); }

		if (supports32) {
			const portrait = await createRipple({ ...gpu, enable32bitDataTextures: true }, 72, 128);
			try {
				const pixels = await portrait.render(tick, tick * 1000, [{ ...fastStroke[0], start: [0, -0.42], end: [0, 0.42] }]);
				check(pixels[(64 * 96 + 32) * 2] < -0.001, 'portrait horizontal displacement with 32-bit data');
			} finally { portrait.dispose(); }
		}
		const validationError = await device.popErrorScope();
		if (validationError != null) throw new Error(validationError.message);
	} finally { ripple.dispose(); device.destroy(); }
}
