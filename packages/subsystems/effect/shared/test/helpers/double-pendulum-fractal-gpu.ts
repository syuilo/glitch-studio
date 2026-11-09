import definition from '../../src/fx/doublePendulumFractal/_def_.ts';
import implementation from '../../src/fx/doublePendulumFractal/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { EffectOutputDataMap, RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type OutputPort = keyof typeof definition.outputDefs;

const wrapAngle = (angle: number) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

// GPU側の縮約式を転記せず、独立したラグランジュ方程式の質量行列を解く。
// 参照計算はf64・十分小さな刻みを使い、GPUの刻みや式変形に依存しない解へ近づける。
function referenceState(params: Parameters) {
	let state = [params.angleCenter1, params.angleCenter2, params.initialAngularVelocity1, params.initialAngularVelocity2];
	const derivative = ([angle1, angle2, velocity1, velocity2]: number[]) => {
		const lowerMass = params.massRatio;
		const lowerLength = params.lengthRatio;
		const sine = Math.sin(angle1 - angle2);
		const firstMass = 1 + lowerMass;
		const couplingMass = lowerMass * lowerLength * Math.cos(angle1 - angle2);
		const secondMass = lowerMass * lowerLength * lowerLength;
		const firstForce = -(1 + lowerMass) * params.gravity * Math.sin(angle1) - lowerMass * lowerLength * sine * velocity2 * velocity2;
		const secondForce = -lowerMass * params.gravity * lowerLength * Math.sin(angle2) + lowerMass * lowerLength * sine * velocity1 * velocity1;
		const determinant = firstMass * secondMass - couplingMass * couplingMass;
		return [velocity1, velocity2, (secondMass * firstForce - couplingMass * secondForce) / determinant, (firstMass * secondForce - couplingMass * firstForce) / determinant];
	};
	const stepCount = Math.ceil(params.simulationTime / 0.0001);
	const timeStep = params.simulationTime / stepCount;
	for (let step = 0; step < stepCount; step++) {
		const first = derivative(state);
		const second = derivative(state.map((value, index) => value + first[index] * timeStep * 0.5));
		const third = derivative(state.map((value, index) => value + second[index] * timeStep * 0.5));
		const fourth = derivative(state.map((value, index) => value + third[index] * timeStep));
		state = state.map((value, index) => value + (first[index] + 2 * second[index] + 2 * third[index] + fourth[index]) * timeStep / 6);
	}
	return [wrapAngle(state[0]), wrapAngle(state[1]), state[2], state[3]];
}

export async function run(benchmark = false) {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const vertex = device.createShaderModule({ code: vertexCode });
	const checks: string[] = [];
	const timings: { resolution: string; simulationTime: number; milliseconds: number }[] = [];
	const resources: (() => void)[] = [];
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, structuredClone(parameter.defaultValue.value)])) as Parameters;
	const assert = (condition: boolean, label: string) => {
		if (!condition) throw new Error(label);
		checks.push(label);
	};
	const near = (actual: number, expected: number, label: string, tolerance = 0.0002) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ~= ${expected}`);
	const allPorts: OutputPort[] = ['output', 'angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'];
	const statePorts: OutputPort[] = ['angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'];
	const readLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [readLayout] }), vertex: { module: vertex }, fragment: {
		module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba32float' }],
	} });
	function createRenderer(width: number, height: number, useFloat32 = true, ports = allPorts) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: useFloat32 };
		const outputDataMap: Partial<EffectOutputDataMap<typeof definition.outputDefs>> = {};
		const rowBytes = Math.ceil(width * 16 / 256) * 256;
		const readbacks = new Map<OutputPort, { buffer: GPUBuffer; texture: GPUTexture; group: GPUBindGroup }>();
		for (const port of ports) {
			const texture = implementation.outputTextureFactories[port]({ wgpu, resolution });
			outputDataMap[port] = { texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null };
			const copy = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const buffer = device.createBuffer({ size: rowBytes * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			const group = device.createBindGroup({ layout: readLayout, entries: [{ binding: 0, resource: texture.createView() }] });
			readbacks.set(port, { texture: copy, buffer, group });
			resources.push(() => { texture.destroy(); copy.destroy(); buffer.destroy(); });
		}
		const fallback = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: fallback, reportStatus: () => {} });
		resources.push(() => { instance.dispose(); fallback.destroy(); });
		return {
			outputDataMap,
			async render(overrides: Partial<Parameters> = {}, clock = 0, delta = 0) {
				device.pushErrorScope('validation');
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder,
					outputDataMap: outputDataMap as EffectOutputDataMap<typeof definition.outputDefs>, usedOutputPorts: new Set(ports),
					time: clock, timeDelta: delta, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
					createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				});
				for (const readback of readbacks.values()) {
					const pass = encoder.beginRenderPass({ colorAttachments: [{ view: readback.texture.createView(), loadOp: 'clear', storeOp: 'store' }] });
					pass.setPipeline(reader); pass.setBindGroup(0, readback.group); pass.draw(3); pass.end();
					encoder.copyTextureToBuffer({ texture: readback.texture }, { buffer: readback.buffer, bytesPerRow: rowBytes }, resolution);
				}
				device.queue.submit([encoder.finish()]);
				const values = new Map<OutputPort, Float32Array>();
				for (const [port, readback] of readbacks) {
					await readback.buffer.mapAsync(GPUMapMode.READ);
					values.set(port, new Float32Array(readback.buffer.getMappedRange().slice(0)));
					readback.buffer.unmap();
				}
				const error = await device.popErrorScope();
				if (error != null) throw new Error(error.message);
				return {
					values,
					pixel(port: OutputPort, x = (width - 1) / 2, y = (height - 1) / 2) { return Array.from(values.get(port)!.slice(y * rowBytes / 4 + x * 4, y * rowBytes / 4 + x * 4 + 4)); },
				};
			},
		};
	}
	try {
		const single = createRenderer(1, 1);
		// 【無重力で両方が同じ速度で回る解析解を、端数時刻と周回をまたいで再現する】
		// 角度差0では加速度0となるため、参照側に同じ数値積分を書かず時間刻みと角度折返しを検証できる。
		for (const simulationTime of [0, 0.003, 0.375]) {
			const pixels = await single.render({ simulationTime, gravity: 0, angleCenter1: 2.7, angleCenter2: 2.7, initialAngularVelocity1: 1.3, initialAngularVelocity2: 1.3 });
			for (const port of ['angle1', 'angle2'] as const) near(pixels.pixel(port)[0], wrapAngle(2.7 + 1.3 * simulationTime), `${port} exact free rotation at ${simulationTime}`);
			for (const port of ['angularVelocity1', 'angularVelocity2'] as const) near(pixels.pixel(port)[0], 1.3, `${port} constant free rotation`);
		}
		// 【長さ比・質量比・重力・初期角速度が連成運動へ反映される】
		// 対称な初期条件だけでは見つからない、添字や長さ係数の取り違えを独立した質量行列の解で検出する。
		for (const [lengthRatio, massRatio] of [[1, 1], [0.7, 2.1], [2, 0.4]]) {
			const parameters = { ...defaults, simulationTime: 0.375, angleCenter1: 0.7, angleCenter2: -0.4, initialAngularVelocity1: 0.2, initialAngularVelocity2: -0.3, lengthRatio, massRatio };
			const expected = referenceState(parameters);
			const actual = await single.render(parameters);
			statePorts.forEach((port, index) => near(actual.pixel(port)[0], expected[index], `${port} independent dynamics ${lengthRatio}/${massRatio}`));
		}
		// 【静止平衡と元動画の二角度配色を確認する】
		// 画面中央の下向き振り子は動かず、色の計算が初期角度や片方の角度だけを使っていないことも確認する。
		const equilibrium = await single.render({ simulationTime: 2 });
		for (const port of statePorts) near(equilibrium.pixel(port)[0], 0, `${port} stationary equilibrium`);
		const colored = await single.render({ simulationTime: 0.375, angleCenter1: 0.7, angleCenter2: -0.4 });
		const angle1 = colored.pixel('angle1')[0];
		const angle2 = colored.pixel('angle2')[0];
		const expectedColor = [0.5 + 0.5 * Math.sin(angle1) * Math.cos(angle2), 0.5 + 0.5 * Math.sin(angle1) * Math.sin(angle2), 0.5 + 0.5 * Math.cos(angle1), 1];
		expectedColor.forEach((value, channel) => near(colored.pixel('output')[channel], value, `spherical RGB color channel ${channel}`, 0.001));
		// 【シーク・FPS・時計から独立し、配色変更が数値出力を変えない】
		// 同じインスタンスを異なる順序・描画間隔で呼び、積算した状態や前回の端数が混ざらないことを実画素で確認する。
		await single.render({ simulationTime: 1.25 }, 100, 1000 / 30);
		const repeat = await single.render({ simulationTime: 0.375, angleCenter1: 0.7, angleCenter2: -0.4 }, 5, 1000 / 120);
		for (const port of allPorts) assert(repeat.values.get(port)!.every((value, index) => value === colored.values.get(port)![index]), `${port} independent of render history and clock`);
		const ramp: ColorRamp = { interpolation: 'linear', colorSpace: 'srgb', stops: [
			{ id: 'start', position: 0, color: [1, 0, 0, 0.5] }, { id: 'end', position: 1, color: [0, 0, 1, 0.5] },
		] };
		const ramped = await single.render({ simulationTime: 0.375, angleCenter1: 0.7, angleCenter2: -0.4, coloringMethod: 'angle2', ramp });
		for (const port of statePorts) near(ramped.pixel(port)[0], colored.pixel(port)[0], `${port} unaffected by coloring`);
		// 【角度の正規化と符号付き角速度のRampを、乗算済み透明度で出力する】
		// 角速度は絶対値にせず、負・0・正をRampの0・0.5・1へ対応させる。AAでも透明度を二重乗算しない。
		for (const coloringMethod of ['angle1', 'angle2', 'angularVelocity1', 'angularVelocity2'] as const) {
			const midpoint = await single.render({ coloringMethod, ramp, antialiasing: true });
			[0.25, 0, 0.25, 0.5].forEach((value, channel) => near(midpoint.pixel('output')[channel], value, `${coloringMethod} transparent midpoint channel ${channel}`, 0.001));
		}
		for (const [coloringMethod, expected] of [['angularVelocity1', [0, 0, 0.5, 0.5]], ['angularVelocity2', [0.5, 0, 0, 0.5]]] as const) {
			const velocityColor = await single.render({ coloringMethod, ramp, initialAngularVelocity1: 20, initialAngularVelocity2: -20 });
			expected.forEach((value, channel) => near(velocityColor.pixel('output')[channel], value, `${coloringMethod} signed endpoint channel ${channel}`, 0.001));
		}
		// 【縦横比と解像度が違っても共通座標の同じ位置を同じ角度へ変換する】
		// 画像の各軸を別々に2piへ伸ばす実装では、横長・縦長の短辺側だけが変わる。
		for (const [width, height] of [[9, 9], [9, 5], [5, 9], [27, 27]]) {
			const renderer = createRenderer(width, height);
			const pixels = await renderer.render();
			const offset = width === 27 ? 3 : 1;
			near(pixels.pixel('angle1', (width - 1) / 2 + offset, (height - 1) / 2)[0], 2 * Math.PI / 9, `${width}x${height} isotropic X`);
			near(pixels.pixel('angle2', (width - 1) / 2, (height - 1) / 2 + offset)[0], 2 * Math.PI / 9, `${width}x${height} isotropic Y points downward`);
		}
		// 【周期境界のAAはpi付近を0付近へ反転させない】
		// 角度のデータには円周平均を使い、色の4点平均や角速度の算術平均とは区別する。
		const antialiased = await createRenderer(9, 9).render({ angleCenter1: Math.PI, angleCenter2: Math.PI, antialiasing: true });
		for (const port of ['angle1', 'angle2'] as const) near(Math.abs(antialiased.pixel(port)[0]), Math.PI, `${port} circular AA across pi`);
		// 【画像が不要な疎なattachmentと、16bitのデータ出力でも同じ物理量を返す】
		// 未確保のポートを参照したり、単独出力時にlocationを詰めたりする不具合を検出する。
		const sparse = createRenderer(1, 1, false, ['angle2']);
		assert(sparse.outputDataMap.output == null && sparse.outputDataMap.angle1 == null, 'unused outputs are not allocated');
		assert(sparse.outputDataMap.angle2!.texture.format === 'r16float', 'data precision selects r16float');
		const sparsePixels = await sparse.render({ simulationTime: 0.375, angleCenter1: 0.7, angleCenter2: -0.4 });
		near(sparsePixels.pixel('angle2')[0], colored.pixel('angle2')[0], 'sparse half precision matches shared integration', 0.001);
		assert(single.outputDataMap.angle1!.texture.format === 'r32float', 'data precision selects r32float');
		if (benchmark) {
			// 測定時だけ実行する。初回コンパイルを除き、GPU完了と読み戻しを含む経過時間を記録する。
			const measured = createRenderer(256, 256, true, ['output']);
			await measured.render();
			for (const simulationTime of [1, 5, 10]) {
				const started = performance.now();
				await measured.render({ simulationTime });
				timings.push({ resolution: '256x256', simulationTime, milliseconds: performance.now() - started });
			}
		}
		return { checks, timings };
	} finally {
		for (const dispose of resources.reverse()) dispose();
		device.destroy();
	}
}
