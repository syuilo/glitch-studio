import { nativeEffectProbe } from '@gs/subsystems_effect_native-effects/test/native-effect-probe.ts';
import gradientNative from '@gs/subsystems_effect_native-effects/fx/gradient/_impl_.ts';
import definition from '@gs/subsystems_effect_native-effects/fx/gradient/_def_.ts';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { evaluateFunctionCurve } from '@gs/shared/function-curve/function-curve-evaluator.ts';
import { EASING_DIRECTIONS, EASING_FAMILIES } from '@gs/shared/easing.ts';
import { float32ToFloat16Bits } from '@gs/shared/utility/float32ToFloat16Bits.ts';
import type { BezierAnchorPoint, BezierFunctionCurve, FunctionCurve } from '@gs/shared/function-curve/function-curve.ts';

const gradient = nativeEffectProbe(definition, gradientNative);

function fromHalf(bits: number) {
	const exponent = (bits >> 10) & 31;
	const fraction = bits & 1023;
	return (bits & 32768 ? -1 : 1) * (exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? (fraction ? NaN : Infinity) : (1 + fraction / 1024) * 2 ** (exponent - 15));
}

// Gradientの値と符号付き微分を、色としてclampせず直接読み戻す。
export async function checkGradientInputs(device: GPUDevice, vertex: GPUShaderModule) {
	const completed: string[] = [];
	function check(name: string, actual: number[], expected: number[]) {
		if (actual.length !== expected.length || actual.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected[i]) > 0.003)) throw new Error(`${name}: ${actual} != ${expected}`);
	}
	for (const enable32bitDataTextures of [false, true]) {
		if (enable32bitDataTextures && !device.features.has('float32-filterable')) continue;
		device.pushErrorScope('validation');
		const textures: GPUTexture[] = [];
		const context = { wgpu: { device, defaultVertexShaderModule: vertex, enable32bitDataTextures }, resolution: { width: 4, height: 4 } } as any;
		const instance = gradient.place(context.wgpu, context.resolution);
		function texture(width: number, height: number, channels: number, values?: number[]) {
			const format = (channels === 1 ? 'r' : 'rg') + (enable32bitDataTextures ? '32float' : '16float') as GPUTextureFormat;
			const output = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
			textures.push(output);
			if (values) {
				const bytes = enable32bitDataTextures ? new Float32Array(values) : new Uint16Array(values.map(float32ToFloat16Bits));
				device.queue.writeTexture({ texture: output }, bytes, { bytesPerRow: width * channels * (enable32bitDataTextures ? 4 : 2) }, [width, height]);
			}
			return output;
		}
		const scalar = texture(4, 4, 1);
		const vector = texture(4, 4, 2);
		const buffer = device.createBuffer({ size: 2048, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		async function render(params: any, needsVector: boolean) {
			const encoder = device.createCommandEncoder();
			const outputs: any = { scalar: scalar };
			if (needsVector) outputs.vector = vector;
			await instance.draw({
				params,
				commandEncoder: encoder,
				outputs,
				usedOutputPorts: new Set(needsVector ? ['scalar', 'vector'] : ['scalar']),
			} as any);
			encoder.copyTextureToBuffer({ texture: scalar }, { buffer, bytesPerRow: 256 }, [4, 4]);
			if (needsVector) encoder.copyTextureToBuffer({ texture: vector }, { buffer, offset: 1024, bytesPerRow: 256 }, [4, 4]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const data = new DataView(buffer.getMappedRange());
			const decode = (offset: number, channels: number) => Array.from({ length: 16 * channels }, (_, index) => {
				const address = offset + Math.floor(index / (4 * channels)) * 256 + index % (4 * channels) * (enable32bitDataTextures ? 4 : 2);
				return enable32bitDataTextures ? data.getFloat32(address, true) : fromHalf(data.getUint16(address, true));
			});
			const result = { scalar: decode(0, 1), vector: needsVector ? decode(1024, 2) : [] };
			buffer.unmap();
			return result;
		}
		try {
			const params: Record<string, any> = {};
			const inputs: { name: string; uniform: any; texture: any }[] = [];
			for (const [name, param] of Object.entries(definition.paramDefs) as [string, any][]) {
				const value = param.defaultValue;
				params[name] = param.canNode ? constantShaderInput('scalar', value) : value;
				if (param.canNode) inputs.push({ name, uniform: params[name], texture: textureShaderInput(texture(1, 1, 1, [value]), { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }) });
			}
			// 全128入力構成でscalar単独と複数出力を比較する。最後は退避した構成へ戻す。
			const baseline = await render(params, true);
			check('linear gradient values', baseline.scalar, [0.875, 0.625, 0.375, 0.125].flatMap(v => [v, v, v, v]));
			check('linear gradient derivatives', baseline.vector, Array.from({ length: 16 }, () => [0, 1]).flat());
			for (let iteration = 0; iteration <= 128; iteration++) {
				const mask = iteration % 128;
				inputs.forEach((input, index) => { params[input.name] = mask & (1 << index) ? input.texture : input.uniform; });
				const scalarOnly = await render(params, false);
				const both = await render(params, true);
				check(`gradient scalar variant ${mask}`, scalarOnly.scalar, baseline.scalar);
				check(`gradient MRT scalar variant ${mask}`, both.scalar, baseline.scalar);
				check(`gradient vector variant ${mask}`, both.vector, baseline.vector);
			}
			// Radialでも既存の解析的微分と+Y方向を維持する。
			params.mode = 'radial';
			params.sizeReference = 'longSide';
			const radial = await render(params, true);
			const radius = Math.hypot(-0.25, 0.25);
			check('radial value and derivative', [radial.scalar[5], ...radial.vector.slice(10, 12)], [radius, -0.5 / radius, 0.5 / radius]);
			params.mode = 'linear';
			// 【同じ配置で曲線を差し替え、プレビューと同じ値・傾きを描画する】
			// WGSLとCPUの曲線定義のずれや、曲線の変更後にGPUのデータが更新されない回帰を検出する。
			const positions = [0.875, 0.625, 0.375, 0.125];
			const rows = (values: number[]) => values.flatMap(value => [value, value, value, value]);
			const rowVectors = (values: number[]) => rows(values).flatMap(value => [0, value]);
			const bezierPoint = (id: string, x: number, y: number, incoming: [number, number] = [0, 0], outgoing: [number, number] = [0, 0]): BezierAnchorPoint => ({
				id, x, y, bezierControlPointA: incoming, bezierControlPointB: outgoing,
			});
			const bezier = (points: BezierAnchorPoint[]): BezierFunctionCurve => ({ type: 'bezier', isXNormalized: true, isYNormalized: true, points });
			const curves: FunctionCurve[] = [
				{ type: 'smoothstep' }, { type: 'smootherstep' }, { type: 'smoothPulse' }, { type: 'sineWave' }, { type: 'deadZone', deadZoneWidth: 0.5 },
				bezier([bezierPoint('end', 1, 0.75, [-0.2, -1]), bezierPoint('start', 0, 0.25, [0, 0], [0.15, 1])]),
				bezier([bezierPoint('only', 0.5, -0.25)]), bezier([]),
			];
			for (const family of EASING_FAMILIES) for (const direction of EASING_DIRECTIONS) {
				if (family === 'back') curves.push({ type: 'easing', family, direction, overshootCoefficient: 2.5 });
				else if (family === 'elastic') curves.push({ type: 'easing', family, direction, period: 0.45 });
				else curves.push({ type: 'easing', family, direction });
			}
			for (const curve of curves) {
				params.interpolation = curve;
				const result = await render(params, true);
				const evaluate = (position: number) => evaluateFunctionCurve(curve, position, 'clamp');
				const label = curve.type === 'easing' ? `${curve.family} ${curve.direction}` : curve.type;
				check(`${label} value follows CPU Function Curve`, result.scalar, rows(positions.map(evaluate)));
				check(`${label} slope follows CPU Function Curve`, result.vector, rowVectors(positions.map(position => (evaluate(position + 0.0001) - evaluate(position - 0.0001)) / 0.0002)));
			}
			// 【不連続な曲線の境界で補間値をにじませず、勾配を作らない】
			// Pulseの両境界は異なる側に属する。同じXのBézier点では編集順の最後の値を使う。
			const discontinuous: [FunctionCurve, number[]][] = [
				[{ type: 'pulse', dutyCycle: 0.25 }, [0, 0, 1, 0]],
				[{ type: 'steps', levelCount: 4 }, [1, 2 / 3, 1 / 3, 0]],
				[bezier([bezierPoint('before', 0.375, 0), bezierPoint('end', 1, 0.75), bezierPoint('start', 0, 0), bezierPoint('after', 0.375, 0.75)]), [0.75, 0.75, 0.75, 0]],
			];
			for (const [curve, expected] of discontinuous) {
				params.interpolation = curve;
				const result = await render(params, true);
				check(`${curve.type} keeps sharp boundaries`, result.scalar, rows(expected));
				check(`${curve.type} discontinuous slopes are zero`, result.vector, Array(32).fill(0));
			}
			// 【曲線の端点をValue A・Value Bへ写像する】
			// クランプした区間外でもSmooth Pulseの出力は0なので、上端・下端のどちらもValue Aで止まる。
			params.interpolation = { type: 'smoothPulse' };
			params.startPosition = constantShaderInput('scalar', 0.25);
			params.endPosition = constantShaderInput('scalar', 0.75);
			params.startValue = constantShaderInput('scalar', 10);
			params.endValue = constantShaderInput('scalar', 20);
			check('both Smooth Pulse endpoints produce Value A', (await render(params, false)).scalar, rows([10, 15, 15, 10]));
			for (const input of inputs) params[input.name] = input.uniform;
			// 【垂直接線の近くでGPU描画とプレビューのYが一致する】
			// Yが線形の曲線で、Xがほとんど変化しない中点付近の逆算を確認する。
			const steepCurve = bezier([bezierPoint('start', 0, 0, [0, 0], [1, 1 / 3]), bezierPoint('end', 1, 1, [-1, -1 / 3])]);
			const steepXOffset = 2 ** -20;
			params.interpolation = steepCurve;
			params.phase = constantShaderInput('scalar', 0.125 + steepXOffset);
			const steep = await render(params, true);
			check('steep Bézier follows CPU evaluation', [steep.scalar[8]], [evaluateFunctionCurve(steepCurve, 0.5 + steepXOffset, 'clamp')]);
			params.phase = constantShaderInput('scalar', 0);
			// 【ミラー反復でBézierの傾きの符号が反転する】
			// Xが線形、Yが二次のBézierを往復させ、相対する側へ同じ大きさの勾配が出ることを確認する。
			params.interpolation = bezier([bezierPoint('start', 0, 0, [0, 0], [1 / 3, 0]), bezierPoint('end', 1, 1, [-1 / 3, -2 / 3])]);
			params.mirrorRepeat = true;
			const mirrored = await render(params, true);
			check('mirrored Bézier values', mirrored.scalar, rows([0.0625, 0.5625, 0.5625, 0.0625]));
			check('mirrored Bézier slopes change direction', mirrored.vector, rowVectors([-1, -3, 3, 1]));
			params.interpolation = definition.paramDefs.interpolation.defaultValue;
			params.mirrorRepeat = false;
			// 同じ空間入力を両端値へ渡すと、結果と微分は入力そのものになる。
			// 異なる比率の入力でfitと全wrapを確認し、透明境界の1x1も含める。
			for (const [width, height, values] of [[4, 2, [0, 0.125, 0.375, 0.75, 0.25, 0.5, 0.625, 1]], [1, 1, [0.75]]] as const) {
				const source = texture(width, height, 1, [...values]);
				for (const fitMode of ['stretch', 'cover', 'contain'] as const) {
					const ratio = width / height;
					const scale = fitMode === 'stretch' ? [1, 1] : fitMode === 'cover' ? [Math.min(1, 1 / ratio), Math.min(1, ratio)] : [Math.max(1, 1 / ratio), Math.max(1, ratio)];
					for (const wrapMode of ['clamp', 'repeat', 'repeatMirrored', 'transparent'] as const) {
						params.startValue = params.endValue = textureShaderInput(source, { filterMode: 'linear', fitMode, wrapMode });
						const result = await render(params, true);
						function index(value: number, size: number) {
							if (wrapMode === 'repeat') return ((value % size) + size) % size;
							if (wrapMode === 'repeatMirrored') { const v = ((value % (2 * size)) + 2 * size) % (2 * size); return v < size ? v : 2 * size - 1 - v; }
							return Math.max(0, Math.min(size - 1, value));
						}
						function sample(x: number, y: number) {
							if (wrapMode === 'transparent' && (x < 0 || y < 0 || x >= width || y >= height)) return 0;
							return values[index(y, height) * width + index(x, width)];
						}
						const expectedScalar: number[] = [];
						const expectedVector: number[] = [];
						for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
							const px = (((x + 0.5) / 4 - 0.5) * scale[0] + 0.5) * width - 0.5;
							const py = (((y + 0.5) / 4 - 0.5) * scale[1] + 0.5) * height - 0.5;
							const ix = Math.floor(px), iy = Math.floor(py), wx = px - ix, wy = py - iy;
							const a = sample(ix, iy), b = sample(ix + 1, iy), c = sample(ix, iy + 1), d = sample(ix + 1, iy + 1);
							expectedScalar.push((a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy);
							expectedVector.push(((b - a) * (1 - wy) + (d - c) * wy) * width * scale[0], -((c - a) * (1 - wx) + (d - b) * wx) * height * scale[1]);
						}
						check(`gradient ${width} ${fitMode} ${wrapMode} value`, result.scalar, expectedScalar);
						check(`gradient ${width} ${fitMode} ${wrapMode} derivative`, result.vector, expectedVector);
					}
				}
			}
			// nearestの入力微分は画素内・境界とも0。linearへ戻したときには復元される。
			const stepSource = texture(2, 2, 1, [0.125, 0.875, 0.125, 0.875]);
			params.startValue = params.endValue = textureShaderInput(stepSource, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'nearest' });
			const nearest = await render(params, true);
			check('nearest gradient values', nearest.scalar, Array.from({ length: 4 }, () => [0.125, 0.125, 0.875, 0.875]).flat());
			check('nearest input derivatives are zero', nearest.vector, Array(32).fill(0));
			params.startValue = params.endValue = textureShaderInput(stepSource, { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
			const linear = await render(params, true);
			check('restores linear input derivative', linear.vector.slice(2, 4), [1.5, 0]);
			const error = await device.popErrorScope();
			if (error) throw new Error(error.message);
			completed.push(`gradient inputs and derivatives ${enable32bitDataTextures ? 32 : 16}bit`);
		} finally {
			instance.dispose();
			buffer.destroy();
			for (const t of textures) t.destroy();
		}
	}
	return completed;
}
