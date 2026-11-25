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
	const clickX = 8;
	const clickY = 4;
	const click = { position: [clickX / longSide, clickY / longSide], time: 2 } as const;

	async function createRipple(width: number, height: number, ports: readonly string[], enable32bitDataTextures: boolean,
		{ reflectivity, duration }: { reflectivity?: number; duration?: number } = {}) {
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
				...(reflectivity == null ? {} : { reflectivity: { kind: 'value', value: reflectivity } }),
				...(duration == null ? {} : { duration: { kind: 'value', value: duration } }),
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
					return read(Math.floor(width / 2) + x, Math.floor(height / 2) - y, channel);
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
			const ripple = await createRipple(width, height, ports, precise);
			try {
				const empty = await ripple.render(firstTime, [{ ...click, time: firstTime + 1 }]);
				const single = await ripple.render(firstTime, [click]);
				const overlap = await ripple.render(firstTime, [click, click]);
				const later = await ripple.render(click.time + 32 / longSide, [click]);
				const expired = await ripple.render(click.time + 1, [click]);
				for (const port of ports) {
					const crest = port === 'mask' ? 1 : 0.02;
					near(empty(port, clickX + 10, clickY), 0, 'future click');
					near(single(port, clickX + 10, clickY), crest, 'horizontal crest');
					near(single(port, clickX, clickY + 10, port === 'mask' ? 0 : 1), crest, 'vertical crest');
					near(single(port, clickX + 14, clickY), port === 'mask' ? 0 : -crest, 'signed trough');
					near(single(port, clickX + 22, clickY), 0, 'ahead of the front');
					near(later(port, clickX + 22, clickY), crest, 'propagating crest');
					near(overlap(port, clickX + 10, clickY), port === 'mask' ? crest : crest * 2, 'overlap');
					near(expired(port, clickX + 10, clickY), 0, 'expired click');
				}
			} finally { ripple.dispose(); }
		}

		const ports = ['output', 'mask'];
		const direct = await createRipple(129, 65, ports, true);
		try {
			const reflected = await createRipple(129, 65, ports, false, { reflectivity: 0.8, duration: 2 });
			try {
				const rightWallPress = { position: [56 / longSide, 0], time: 2 } as const;
				const beforeWall = rightWallPress.time + 7 / longSide;
				const incoming = await direct.render(beforeWall, [rightWallPress]);
				const incomingWithReflection = await reflected.render(beforeWall, [rightWallPress]);
				near(incomingWithReflection('mask', 52, 0), incoming('mask', 52, 0), 'no reflected crest before the wave reaches the wall');
				near(incomingWithReflection('output', 52, 0), incoming('output', 52, 0), 'no reflected displacement before the wave reaches the wall');

				// 【四辺から返った波だけを読む】
				// 各測定点は押下から4px、鏡像から21px。半径31pxでは幅24pxの直接波が通り過ぎ、鏡像だけが山を作る。
				const waveAtWalls = 2 + 31 / longSide;
				for (const [pressX, pressY, sampleX, sampleY, channel, direction] of [
					[56, 0, 52, 0, 0, -1],
					[-56, 0, -52, 0, 0, 1],
					[0, 24, 0, 20, 1, -1],
					[0, -24, 0, -20, 1, 1],
				]) {
					const afterWall = await reflected.render(waveAtWalls, [{ position: [pressX / longSide, pressY / longSide], time: 2 }]);
					near(afterWall('mask', sampleX, sampleY), 0.8, 'wall reflection crest');
					near(afterWall('output', sampleX, sampleY, channel), direction * 0.8 * 0.02, 'wall reflection displacement');
				}
				const disabled = await direct.render(waveAtWalls, [rightWallPress]);
				near(disabled('mask', 52, 0), 0, 'default reflectivity leaves the reflected crest disabled');
				near(disabled('output', 52, 0), 0, 'default reflectivity leaves the reflected displacement disabled');

				// 【角では縦横両方の壁を通った波だけを読む】
				// 1回までの反射波は測定点を過ぎており、二重の鏡像（85,49）から来た波の振幅だけが残る。
				const cornerPress = { position: [48 / longSide, 16 / longSide], time: 2 } as const;
				const cornerReflection = await reflected.render(2 + (Math.hypot(37, 37) + 10) / longSide, [cornerPress]);
				near(cornerReflection('mask', 44, 12), 0.64, 'corner reflectivity applied twice');
				near(cornerReflection('output', 44, 12), -0.64 * 0.02 / Math.SQRT2, 'corner displacement x');
				near(cornerReflection('output', 44, 12, 1), -0.64 * 0.02 / Math.SQRT2, 'corner displacement y');

				const overlapping = await reflected.render(waveAtWalls, Array.from({ length: 16 }, () => rightWallPress));
				near(overlapping('mask', 52, 0), 0.8, 'overlapping reflections retain the highest crest');
				near(overlapping('output', 52, 0), -16 * 0.8 * 0.02, 'all sixteen reflected displacements contribute');

				const outsidePress = { position: [73 / longSide, 0], time: 2 } as const;
				const outsideBeforeArrival = await reflected.render(2 + 14 / longSide, [outsidePress]);
				near(outsideBeforeArrival('mask', 52, 0), 0, 'an outside click does not reflect into the drawing area');
				const outsideAfterArrival = await reflected.render(waveAtWalls, [outsidePress]);
				near(outsideAfterArrival('mask', 52, 0), 1, 'the direct wave from outside still reaches the drawing area');
			} finally { reflected.dispose(); }
		} finally { direct.dispose(); }

		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return true;
	} finally { device.destroy(); }
}
