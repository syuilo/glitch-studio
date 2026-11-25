import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { Resolution } from '@gs/shared/resolution.ts';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { EffectGpuContext, EffectPointerClick } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import definition from '../../src/fx/clickRipple/_def_.ts';
import implementation from '../../src/fx/clickRipple/_impl_.ts';
import { nativeEffectProbe } from './native-effect-probe.ts';

const probe = nativeEffectProbe(definition, implementation);
const readableImplementation = {
	...implementation,
	createOutputTexture(port: string, resolution: Resolution, wgpu: EffectGpuContext) {
		return probe.createTexture(port, { resolution, wgpu });
	},
};

function near(actual: number, expected: number, label: string) {
	if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.001) throw new Error(label + ': ' + actual + ' != ' + expected);
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const defaultVertexShaderModule = device.createShaderModule({ code: vertexCode });
	device.pushErrorScope('validation');
	const longSide = 129;
	const click = { position: [8 / longSide, 4 / longSide], time: 2 } as const;

	async function createRipple(width: number, height: number, ports: string[], enable32bitDataTextures: boolean) {
		const effect = await createEffectInstance({
			effectSource: { type: 'nativeEffect', id: 'clickRipple' },
			definitions: { getNativeEffect: () => definition, getNodesEffect: () => null, getCustomShaderEffect: () => null },
			usedOutputPorts: new Set(ports),
			resolution: { width, height },
			inputs: {
				speed: { kind: 'value', value: 1 },
				wavelength: { kind: 'value', value: 8 / longSide },
				width: { kind: 'value', value: 24 / longSide },
				strength: { kind: 'value', value: 0.02 },
			},
		}, { device, defaultVertexShaderModule, enable32bitDataTextures }, () => readableImplementation);
		return {
			dispose: effect.dispose,
			async render(time: number, pointerClicks?: readonly EffectPointerClick[]) {
				const commandEncoder = device.createCommandEncoder();
				effect.render({ time, timeDelta: 0, pointerClicks }, commandEncoder);
				const outputs = Array.from(effect.outputs, ([port, { texture }]) => {
					const channels = port === 'mask' ? 1 : 2;
					const bytesPerComponent = enable32bitDataTextures ? 4 : 2;
					const bytesPerRow = Math.ceil(width * channels * bytesPerComponent / 256) * 256;
					const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
					commandEncoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
					return { port, channels, stride: bytesPerRow / bytesPerComponent, buffer };
				});
				device.queue.submit([commandEncoder.finish()]);
				const pixels = new Map(await Promise.all(outputs.map(async ({ port, channels, stride, buffer }) => {
					try {
						await buffer.mapAsync(GPUMapMode.READ);
						const data = buffer.getMappedRange().slice(0);
						const values = enable32bitDataTextures ? new Float32Array(data) : new Float16Array(data);
						return [port, (x: number, y: number, channel: number) => values[y * stride + x * channels + channel]] as const;
					} finally { buffer.destroy(); }
				})));
				return (port: string, x: number, y: number, channel = 0) => {
					const read = pixels.get(port);
					if (read == null) throw new Error('Missing output ' + port);
					return read(Math.floor(width / 2) + 8 + x, Math.floor(height / 2) - 4 - y, channel);
				};
			},
		};
	}

	try {
		const firstTime = click.time + 20 / longSide;
		for (const [width, height, ports, precise] of [
			[129, 65, ['output', 'mask'], false],
			[65, 129, ['output'], true],
			[65, 129, ['mask'], true],
		] as const) {
			const ripple = await createRipple(width, height, [...ports], precise);
			try {
				const empty = await ripple.render(firstTime, [{ ...click, time: firstTime + 1 }]);
				const single = await ripple.render(firstTime, [click]);
				const overlap = await ripple.render(firstTime, [click, click]);
				const later = await ripple.render(click.time + 32 / longSide, [click]);
				const expired = await ripple.render(click.time + 1, [click]);
				for (const port of ports) {
					const crest = port === 'mask' ? 1 : 0.02;
					near(empty(port, 10, 0), 0, 'future click');
					near(single(port, 10, 0), crest, 'horizontal crest');
					near(single(port, 0, 10, port === 'mask' ? 0 : 1), crest, 'vertical crest');
					near(single(port, 14, 0), port === 'mask' ? 0 : -crest, 'signed trough');
					near(single(port, 22, 0), 0, 'ahead of the front');
					near(later(port, 22, 0), crest, 'propagating crest');
					near(overlap(port, 10, 0), port === 'mask' ? crest : crest * 2, 'overlap');
					near(expired(port, 10, 0), 0, 'expired click');
				}
			} finally { ripple.dispose(); }
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return true;
	} finally { device.destroy(); }
}
