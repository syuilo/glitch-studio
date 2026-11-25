import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { Resolution } from '@gs/shared/resolution.ts';
import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import type { EffectGpuContext, EffectPointerClick } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import definition from '../../src/fx/clickGradient/_def_.ts';
import implementation from '../../src/fx/clickGradient/_impl_.ts';
import { nativeEffectProbe } from './native-effect-probe.ts';

const probe = nativeEffectProbe(definition, implementation);
type Port = keyof typeof definition.outputDefs;
const longSide = 129;
const bandWidth = 16 / longSide;
const press: EffectPointerClick = { position: [0, 0], time: 0 };

function near(actual: number, expected: number, label: string) {
	if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.004) throw new Error(label + ': ' + actual + ' != ' + expected);
}

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const defaultVertexShaderModule = device.createShaderModule({ code: vertexCode });
	device.pushErrorScope('validation');

	async function createBand(resolution: Resolution, ports: readonly Port[], enable32bitDataTextures: boolean,
		parameters: { duration?: number; interpolation?: string } = {}) {
		const effect = await createEffectInstance({
			effectSource: { type: 'nativeEffect', id: 'clickGradient' },
			definitions: { getNativeEffect: () => definition, getNodesEffect: () => null, getCustomShaderEffect: () => null },
			usedOutputPorts: new Set(ports),
			resolution,
			inputs: Object.fromEntries(Object.entries({ speed: bandWidth, width: bandWidth, ...parameters })
				.map(([id, value]) => [id, { kind: 'value' as const, value }])),
		}, { device, defaultVertexShaderModule, enable32bitDataTextures }, () => ({
			...implementation,
			createOutputTexture(port, dimensions, wgpu: EffectGpuContext) {
				return probe.createTexture(port, { resolution: dimensions, wgpu });
			},
		}));
		return {
			dispose: effect.dispose,
			async render(time: number, pointerClicks: readonly EffectPointerClick[] = [press]) {
				const encoder = device.createCommandEncoder();
				effect.render({ time, timeDelta: 0, pointerClicks }, encoder);
				const bytesPerComponent = enable32bitDataTextures ? 4 : 2;
				const { width, height } = resolution;
				const outputs = [...effect.outputs].map(([port, { texture }]) => {
					const channels = port === 'scalar' ? 1 : 2;
					const bytesPerRow = Math.ceil(width * channels * bytesPerComponent / 256) * 256;
					const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
					encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, resolution);
					return { port, channels, stride: bytesPerRow / bytesPerComponent, buffer };
				});
				device.queue.submit([encoder.finish()]);
				const pixels = new Map(await Promise.all(outputs.map(async ({ port, channels, stride, buffer }) => {
					try {
						await buffer.mapAsync(GPUMapMode.READ);
						const data = buffer.getMappedRange().slice(0);
						const values = enable32bitDataTextures ? new Float32Array(data) : new Float16Array(data);
						return [port, (x: number, y: number, channel: number) =>
							values[(Math.floor(height / 2) - y) * stride + (Math.floor(width / 2) + x) * channels + channel]] as const;
					} finally { buffer.destroy(); }
				})));
				return (port: Port, x: number, y = 0, channel = 0) => pixels.get(port)!(x, y, channel);
			},
		};
	}

	try {
		const landscape = { width: 129, height: 65 };
		const portrait = { width: 65, height: 129 };
		const midpointSlope = 1.5 / bandWidth;
		for (const [resolution, ports, precise] of [
			[landscape, ['scalar', 'vector'], false],
			[portrait, ['scalar'], true],
			[portrait, ['vector'], true],
		] as const) {
			const band = await createBand(resolution, ports, precise);
			try {
				const empty = await band.render(2, [{ ...press, time: 3 }]);
				const expanded = await band.render(2);
				const boundary = await band.render(2.00001);
				const passed = await band.render(8);
				if (ports.some(port => port === 'scalar')) {
					// 【帯だけを描き、先頭と後端の値を保つ】
					// 半径32px、幅16pxの帯で、前方・先頭・中点・後端・中心側をそれぞれ読む。
					near(empty('scalar', 24), 0, 'future press');
					near(boundary('scalar', 32), 1, 'leading value');
					near(expanded('scalar', 24), 0.5, 'midpoint scalar');
					near(expanded('scalar', 28), 0.84375, 'default Smoothstep');
					near(expanded('scalar', 16), 0, 'trailing value');
					near(expanded('scalar', 15), 0, 'behind band');
					const outsideFront = resolution.width > resolution.height ? expanded('scalar', 33) : expanded('scalar', 0, 33);
					near(outsideFront, 0, 'outside the front');
					near(passed('scalar', 24), 0, 'band has exited with infinite duration');
				}
				if (ports.some(port => port === 'vector')) {
					near(empty('vector', 24), 0, 'future press slope');
					near(expanded('vector', 24), midpointSlope, 'horizontal outward slope');
					near(expanded('vector', 0, 24, 1), midpointSlope, 'vertical outward slope');
					near(expanded('vector', -24), -midpointSlope, 'negative side outward slope');
					near(expanded('vector', 16), 0, 'trailing slope');
					near(passed('vector', 24), 0, 'slope after band exits');
					near((await band.render(0.5))('vector', 0), 0, 'no direction at press center');
				}
			} finally { band.dispose(); }
		}

		const finite = await createBand(landscape, ['scalar', 'vector'], true, { duration: 4 });
		try {
			// 【有限寿命では値と勾配を同じ割合で減衰させる】
			// 4秒のうち半分で係数が0.5になり、帯がまだ画面内にある4秒時点でも両出力はゼロになる。
			const halfway = await finite.render(2);
			near(halfway('scalar', 24), 0.25, 'time fade scales scalar');
			near(halfway('vector', 24), midpointSlope / 2, 'time fade scales slope');
			const almostExpired = await finite.render(3.99);
			near(almostExpired('scalar', 56), 0, 'smooth approach to expiration');
			const expired = await finite.render(4);
			near(expired('scalar', 56), 0, 'scalar vanishes at duration');
			near(expired('vector', 56), 0, 'slope vanishes at duration');

			// 【重なりでは時間減衰後の値で採用する帯を選ぶ】
			// x=28では時間減衰前の値は古い帯が0.844、新しい帯が0.684。減衰後は新しい帯が勝ち、勾配は左を向く。
			const newer: EffectPointerClick = { position: [46 / longSide, 0], time: 0.5 };
			const combined = await finite.render(2, [newer, press]);
			const newerOnly = await finite.render(2, [newer]);
			near(combined('scalar', 28), newerOnly('scalar', 28), 'overlap selects the faded scalar');
			near(combined('vector', 28), newerOnly('vector', 28), 'overlap selects the same band slope');
			if (!(combined('scalar', 28) > halfway('scalar', 28) && combined('vector', 28) < 0)) throw new Error('Incorrect winner after temporal fade');
		} finally { finite.dispose(); }

		const back = await createBand(landscape, ['scalar', 'vector'], true, { interpolation: 'back' });
		try {
			const overshoot = await back.render(2);
			// Gradientと同様に、先頭寄りで1を上回り、後端寄りで負の値に達する。
			if (!(overshoot('scalar', 30) > 1 && overshoot('scalar', 18) < 0)) throw new Error('Back overshoot was clipped');
		} finally { back.dispose(); }
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return true;
	} finally { device.destroy(); }
}
