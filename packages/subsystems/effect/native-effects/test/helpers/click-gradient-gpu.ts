import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { FunctionCurve } from '@gs/shared/function-curve/function-curve.ts';
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
		parameters: { duration?: number; interpolation?: FunctionCurve; reflectivity?: number } = {}) {
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
		const reflectivity = 0.8;
		const wallPress: EffectPointerClick = { position: [56 / longSide, 0], time: 0 };
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
					if (resolution.width > resolution.height) {
						const defaultReflection = await band.render(29 / 16, [wallPress]);
						near(defaultReflection('scalar', 52), 0, 'reflection is disabled by default');
					}
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

		const finite = await createBand(landscape, ['scalar', 'vector'], true, { duration: 4, reflectivity });
		try {
			// 【有限寿命では値と勾配を同じ割合で減衰させる】
			// 4秒のうち半分で係数が0.5になり、帯がまだ画面内にある4秒時点でも両出力はゼロになる。
			const halfway = await finite.render(2);
			near(halfway('scalar', 24), 0.25, 'time fade scales scalar');
			near(halfway('vector', 24), midpointSlope / 2, 'time fade scales slope');
			const halfwayReflection = await finite.render(2, [wallPress]);
			near(halfwayReflection('scalar', 49), 0.25 * reflectivity, 'time and reflection fades multiply for scalar');
			near(halfwayReflection('vector', 49), -midpointSlope * reflectivity / 2, 'time and reflection fades multiply for slope');
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

		const reflected = await createBand(landscape, ['scalar', 'vector'], false, { reflectivity });
		try {
			// 【壁に届いた帯の値と勾配に反射の減衰を掛ける】
			// 右壁の鏡像はx=73pxにある。x=52pxでは半径29pxのとき鏡像の帯の中点だけを読む。
			const nearWall = await reflected.render(29 / 16, [wallPress]);
			near(nearWall('scalar', 52), 0.5 * reflectivity, 'reflected scalar at the wall');
			near(nearWall('vector', 52), -midpointSlope * reflectivity, 'reflected slope points into the canvas');

			// 【重なった直接の帯と反射の帯を減衰後に比較する】
			// x=64pxでは反射の帯の減衰前の値がより高い。Reflectivityを掛けると直接の帯とその右向きの勾配が勝つ。
			const overlapping = await reflected.render(12 / 16, [wallPress]);
			near(overlapping('scalar', 64), 0.84375, 'reflection attenuation determines the winning band');
			near(overlapping('vector', 64), 1.125 / bandWidth, 'slope follows the winning direct band');

			// 【角の鏡像には両軸の減衰を掛ける】
			// (48, 16)pxの押下を縦横に折り返した(81, 49)pxから、(44, 12)pxへ届いた帯だけを読む。
			const cornerPress: EffectPointerClick = { position: [48 / longSide, 16 / longSide], time: 0 };
			const corner = await reflected.render((Math.hypot(37, 37) + 8) / 16, [cornerPress]);
			near(corner('scalar', 44, 12), 0.5 * reflectivity ** 2, 'corner applies reflectivity twice');
			const cornerSlope = -midpointSlope * reflectivity ** 2 / Math.SQRT2;
			near(corner('vector', 44, 12), cornerSlope, 'corner slope x');
			near(corner('vector', 44, 12, 1), cornerSlope, 'corner slope y');
		} finally { reflected.dispose(); }

		const back = await createBand(landscape, ['scalar', 'vector'], true, {
			interpolation: { type: 'easing', family: 'back', direction: 'inOut', overshootCoefficient: 1.70158 * 1.525 },
		});
		try {
			const overshoot = await back.render(2);
			// Gradientと同様に、先頭寄りで1を上回り、後端寄りで負の値に達する。
			if (!(overshoot('scalar', 30) > 1 && overshoot('scalar', 18) < 0)) throw new Error('Back overshoot was clipped');
		} finally { back.dispose(); }
		// 【両端が0のカーブで帯の後端にも段差ができる】
		// 帯の中でカーブを反転するため、Smooth Pulseは先頭と後端が高く、中心で0になる。
		const pulse = await createBand(landscape, ['scalar', 'vector'], true, { interpolation: { type: 'smoothPulse' } });
		try {
			const band = await pulse.render(2 - 0.00001);
			near(band('scalar', 16), 1, 'Smooth Pulse at the trailing edge');
			near(band('scalar', 15), 0, 'outside the trailing edge');
			near(band('scalar', 24), 0, 'Smooth Pulse midpoint');
			near(band('vector', 20), -Math.PI / bandWidth, 'Smooth Pulse inward slope');
		} finally { pulse.dispose(); }

		// 【Function CurveのSkewで帯の中の変化位置を動かす】
		// Smooth Pulseの中点を先頭から帯幅の75%へ移すと、反転後はその位置が0になる。
		const skewedPulse = await createBand(landscape, ['scalar'], true, { interpolation: { type: 'smoothPulse', skew: 0.5 } });
		try {
			const band = await skewedPulse.render(2);
			near(band('scalar', 20), 0, 'skewed Smooth Pulse midpoint');
			near(band('scalar', 24), 0.25, 'prior midpoint changes');
		} finally { skewedPulse.dispose(); }
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return true;
	} finally { device.destroy(); }
}
