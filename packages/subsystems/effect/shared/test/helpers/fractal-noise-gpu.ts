import definition from '../../src/fx/fractalNoise/_def_.ts';
import implementation from '../../src/fx/fractalNoise/_impl_.ts';
import snoiseDefinition from '../../src/fx/snoise/_def_.ts';
import snoiseImplementation from '../../src/fx/snoise/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import seedrandom from 'seedrandom';
import { verifyFlowNoiseKernel } from './flow-noise-gpu.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
const scalar = (value: number) => constantShaderInput('scalar', value);
const vector = (value: readonly [number, number]) => constantShaderInput('vector', value);

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32bit = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32bit ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex, entryPoint: 'vs' },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) f32 { return textureLoad(image, vec2i(position.xy), 0).r; }` }), targets: [{ format: 'r32float' }] },
	});
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, 'canNode' in parameter && parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

	function createEffect(width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: precise };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === (precise ? 'r32float' : 'r16float'), 'scalar texture format');
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, reportStatus: () => {}, fallbackTexture: output });
		const target = device.createTexture({ size: resolution, format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { instance.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, contextTime = 0) => {
			const encoder = device.createCommandEncoder();
			instance.render({ params: { ...defaults, ...overrides }, commandEncoder: encoder, time: contextTime, timeDelta: 16,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
				createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
				createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width), y * width);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
	}

	function createField(width: number, height: number, precise: boolean, valueAt: (x: number, y: number) => number[]) {
		const texture = device.createTexture({ size: [width, height], format: precise ? 'rgba32float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const values = Array.from({ length: width * height }, (_, index) => {
			const value = valueAt(index % width, Math.floor(index / width));
			return [value[0], value[1] ?? 0, 0, 1];
		}).flat();
		const data = precise ? new Float32Array(values) : new Float16Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4 * data.BYTES_PER_ELEMENT }, [width, height]);
		disposables.push(() => texture.destroy());
		return { input: textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }), values: Array.from(data) };
	}

	try {
		checks.push(...await verifyFlowNoiseKernel(device));
		for (const precise of supports32bit ? [false, true] : [false]) {
			const precisionLabel = precise ? '32bit' : '16bit';
			const near = (actual: number, expected: number, label: string, tolerance = precise ? 0.0002 : 0.002) => {
				assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${precisionLabel} ${label}: ${actual} != ${expected}`);
			};
			const compare = (actual: Float32Array, expected: Float32Array, label: string) => {
				assert(actual.length === expected.length, `${label} dimensions`);
				actual.forEach((value, index) => near(value, expected[index], `${label} pixel ${index}`));
			};
			const render = createEffect(9, 5, precise);
			const sample = createEffect(1, 1, precise);
			for (const noiseType of ['value', 'simplex', 'perlin', 'worley', 'flow'] as const) {
				// 単発ノイズの加重平均との比較ではFlowの段間ワープを0にする。
				// ワープを有効にした構成は後の専用ケースと場入力の比較で確認する。
				const settings: Partial<Parameters> = { noiseType, seed: 31, time: 0.37, flowPhase: 0.173, flowStrength: scalar(0) };
				const label = `${precisionLabel}/${noiseType}`;

				// 【同じ設定なら描画順序・呼び出し側の時刻に依存しない】
				// シークやオフライン書き出しでも、以前のフレームからの蓄積を必要としない。
				const initial = await render(settings);
				assert(Math.max(...initial) - Math.min(...initial) > 0.01, `${label} spatial variation`);
				const later = await render({ ...settings, time: 1.43 });
				assert(initial.some((value, index) => Math.abs(value - later[index]) > 0.01), `${label} time variation`);
				compare(await render(settings, 12345), initial, `${label} deterministic seek`);
				const firstSeed = await render({ ...settings, seed: 16777216 });
				const nextSeed = await render({ ...settings, seed: 16777217 });
				assert(firstSeed.some((value, index) => Math.abs(value - nextSeed[index]) > 0.01), `${label} full precision seeds`);
				compare(await render({ ...settings, seed: 16777216 }), firstSeed, `${label} restored seed`);
				checks.push(`${label} deterministic time and seed`);

				// 【fBmは独立した単発ノイズを指定の振幅・周波数・時計回りの回転で重ねた値になる】
				// 正規化・回転の符号・時間軸の周波数倍率を、既知の4段の加重平均で確認する。
				const point: [number, number] = [-0.17, 0.23];
				const gain = 0.6;
				const lacunarity = 1.7;
				let octavePoint = [...point];
				let octaveTime = 0.37;
				let amplitude = 1;
				let weightedSum = 0;
				let totalWeight = 0;
				const octaveValues: number[] = [];
				for (let octave = 0; octave < 4; octave++) {
					const value = (await sample({ ...settings, coordinateSource: 'input', coordinates: vector(octavePoint as [number, number]), density: vector([1, 1]), time: octaveTime, octaves: 1 }))[0];
					weightedSum += amplitude * value;
					octaveValues.push(value);
					totalWeight += amplitude;
					amplitude *= gain;
					octavePoint = [octavePoint[1] * lacunarity, -octavePoint[0] * lacunarity];
					octaveTime *= lacunarity;
				}
				const fBmSettings: Partial<Parameters> = { ...settings, coordinateSource: 'input', coordinates: vector(point), density: vector([1, 1]), gain: scalar(gain), lacunarity: scalar(lacunarity), octaveRotation: 0.25, octaves: 4 };
				near((await sample(fBmSettings))[0], weightedSum / totalWeight, `${label} weighted octaves`);
				compare(await sample({ ...fBmSettings, octaves: 8, gain: scalar(0) }), await sample({ ...fBmSettings, octaves: 1 }), `${label} zero gain`);
				compare(await sample({ ...fBmSettings, octaves: 0 }), await sample({ ...fBmSettings, octaves: 1 }), `${label} minimum octaves`);
				compare(await sample({ ...fBmSettings, octaves: 17 }), await sample({ ...fBmSettings, octaves: 16 }), `${label} maximum octaves`);
				compare(await sample({ ...fBmSettings, octaves: 2.4 }), await sample({ ...fBmSettings, octaves: 2 }), `${label} rounded octaves`);
				compare(await sample({ ...fBmSettings, octaves: 16, gain: scalar(1), lacunarity: scalar(1), octaveRotation: 0 }), await sample({ ...fBmSettings, octaves: 1 }), `${label} amplitude normalization`);
				checks.push(`${label} normalized rotated octaves`);

				// 【Fractal Modeは合成前の各段を加工する】
				// 単発ノイズの値から求めた4段の加重平均と比較し、合成後に絶対値や
				// 折り返しを適用してしまう誤りを防ぐ。同じinstanceで全モードを切り替える。
				for (const fractalMode of ['turbulence', 'ridged', 'pingPong'] as const) {
					const strength = 2.3;
					const shapedValues = octaveValues.map(value => {
						if (fractalMode === 'turbulence') return Math.abs(2 * value - 1);
						if (fractalMode === 'ridged') return (1 - Math.abs(2 * value - 1)) ** 2;
						const trianglePosition = (2 * value * strength) % 2;
						return trianglePosition <= 1 ? trianglePosition : 2 - trianglePosition;
					});
					const expected = shapedValues.reduce((sum, value, octave) => sum + value * gain ** octave, 0) / totalWeight;
					near((await sample({ ...fBmSettings, fractalMode, pingPongStrength: scalar(strength) }))[0], expected, `${label}/${fractalMode} weighted octaves`, precise ? 0.0003 : 0.004);
					const once = await render({ ...settings, fractalMode });
					await render({ ...settings, fractalMode, time: 3.1 });
					compare(await render({ ...settings, fractalMode }, 1000), once, `${label}/${fractalMode} deterministic seek`);
					checks.push(`${label}/${fractalMode} per-octave shaping and deterministic time`);
				}
				compare(await render(settings), initial, `${label} restored fBm`);
				for (const strength of [0, -1]) {
					const flat = await render({ ...settings, fractalMode: 'pingPong', pingPongStrength: scalar(strength) });
					flat.forEach(value => near(value, 0, `${label} nonpositive ping pong strength`));
				}

				// 【座標場の恒等写像はScreenと一致する】
				// 横長・縦長と全サイズ基準で、座標場の値をUVや変位と取り違えないことを確認する。
				// 画素中心を16bitでも正確に表せる寸法にし、座標場の量子化誤差を混ぜない。
				for (const [width, height] of [[8, 4], [4, 8]]) {
					const renderCoordinates = createEffect(width, height, precise);
					const identity = createField(width, height, precise, (x, y) => [(x + 0.5 - width / 2) / 8, (height / 2 - y - 0.5) / 8]);
					for (const sizeReference of ['height', 'width', 'shortSide', 'longSide'] as const) {
						const screen = await renderCoordinates({ ...settings, sizeReference, coordinateSource: 'screen', coordinates: vector([99, -99]) });
						const input = await renderCoordinates({ ...settings, sizeReference, coordinateSource: 'input', coordinates: identity.input });
						compare(input, screen, `${label} identity ${width}x${height}/${sizeReference}`);
					}
				}
				checks.push(`${label} isotropic screen and input coordinates`);

				// 【同じ座標でのノイズは解像度に依存しない】
				// 3倍の出力で画素中心が一致する場所を比較し、画素数を周波数へ混ぜる誤りを防ぐ。
				const larger = await createEffect(27, 15, precise)(settings);
				initial.forEach((value, index) => near(larger[(Math.floor(index / 9) * 3 + 1) * 27 + index % 9 * 3 + 1], value, `${label} resolution independence`));
				const constantCoordinates = await render({ ...settings, coordinateSource: 'input', coordinates: vector([-3, 4]) });
				constantCoordinates.forEach(value => near(value, constantCoordinates[0], `${label} constant absolute coordinates`));
				checks.push(`${label} resolution independence and constant coordinates`);

				// 【全ての場入力を同時に接続しても、各画素で定数入力と同じ計算になる】
				// 画面外の絶対座標、負の出力範囲、異なるGain・Lacunarityを使い、画像への変換を挟まないことも確認する。
				const fields = {
					coordinates: createField(3, 2, precise, (x, y) => [x * 2 - 3, y * 3 - 2]),
					density: createField(3, 2, precise, (x, y) => [x + 1, y + 0.5]),
					offset: createField(3, 2, precise, (x, y) => [x * 0.25, -y * 0.5]),
					gain: createField(3, 2, precise, x => [x * 0.5]),
					lacunarity: createField(3, 2, precise, (_x, y) => [1.5 + y]),
					pingPongStrength: createField(3, 2, precise, x => [0.5 + 1.25 * x]),
					flowStrength: createField(3, 2, precise, (_x, y) => [0.15 * y]),
					outputMin: createField(3, 2, precise, x => [-3 + x]),
					outputMax: createField(3, 2, precise, (_x, y) => [2 + y]),
				};
				const fieldInputs = Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.input]));
				const renderFields = createEffect(3, 2, precise);
				for (const fractalMode of ['fbm', 'pingPong'] as const) {
					const pixels = await renderFields({ ...settings, fractalMode, coordinateSource: 'input', ...fieldInputs });
					for (let index = 0; index < 6; index++) {
						const uniformInputs: Record<string, ShaderInput> = {};
						for (const [name, field] of Object.entries(fields)) {
							uniformInputs[name] = ['coordinates', 'density', 'offset'].includes(name)
								? vector([field.values[index * 4], field.values[index * 4 + 1]])
								: scalar(field.values[index * 4]);
						}
						near(pixels[index], (await sample({ ...settings, fractalMode, coordinateSource: 'input', ...uniformInputs }))[0], `${label}/${fractalMode} field inputs ${index}`);
					}
				}
				checks.push(`${label} all texture inputs and unbounded coordinates`);

				// 【指定範囲は負値・1超・逆順を含めて保つ】
				// 色としてclampしたり、段数を増やすほど値が増えたりする実装を検出する。
				for (const fractalMode of ['fbm', 'turbulence', 'ridged', 'pingPong'] as const) {
					const modeSettings = { ...settings, fractalMode };
					const normalized = await render(modeSettings);
					const expanded = await render({ ...modeSettings, outputMin: scalar(-2), outputMax: scalar(3) });
					const reversed = await render({ ...modeSettings, outputMin: scalar(3), outputMax: scalar(-2) });
					normalized.forEach((value, index) => {
						assert(Number.isFinite(value) && value >= 0 && value <= 1, `${label}/${fractalMode} normalized range`);
						// 16bitでは比較元の0〜1出力の丸め誤差も5倍される。
						const tolerance = precise ? 0.0002 : 0.004;
						near(expanded[index], -2 + value * 5, `${label}/${fractalMode} expanded range`, tolerance);
						near(reversed[index], 3 - value * 5, `${label}/${fractalMode} reversed range`, tolerance);
					});
					const flat = await render({ ...modeSettings, outputMin: scalar(-2), outputMax: scalar(-2) });
					flat.forEach(value => near(value, -2, `${label}/${fractalMode} flat range`));
				}
				checks.push(`${label} output ranges`);
			}

			// 【全段で共通のFlow Phaseは1 turnで同じ模様へ戻る】
			// 非整数のLacunarityや座標の回転があっても、時間軸と位相を混ぜずに周期を保つ。
			// f32へ丸める前に位相を折り返すことを、大きい値と負値でも検証する。
			const flowSettings: Partial<Parameters> = { noiseType: 'flow', seed: 31, time: 0.37, flowPhase: 0.25, flowStrength: scalar(0.2), lacunarity: scalar(1.7) };
			const flowInitial = await render(flowSettings);
			for (const phase of [-1.75, 1.25, 16777216.25]) compare(await render({ ...flowSettings, flowPhase: phase }), flowInitial, 'Flow phase periodicity');
			const flowLater = await render({ ...flowSettings, flowPhase: 0.5 });
			assert(flowInitial.some((value, index) => Math.abs(value - flowLater[index]) > 0.01), 'Flow phase changes pattern');
			const flowOtherTime = await render({ ...flowSettings, time: 1.43 });
			assert(flowInitial.some((value, index) => Math.abs(value - flowOtherTime[index]) > 0.01), 'Flow Time is independent of phase');
			compare(await render(flowSettings, 9000), flowInitial, 'Flow deterministic seek with warp');
			compare(await render({ ...flowSettings, flowPhase: 1 - 0.00001 }), await render({ ...flowSettings, flowPhase: 0.00001 }), 'Flow phase seam continuity');
			checks.push(`${precisionLabel} Flow phase loops and independent Time`);

			// 【段間ワープは2段目以降だけに適用し、Flow以外のノイズには影響しない】
			// Gainが0のときも第1段だけなので、Strengthを変えても結果は変化しない。
			const unwarped = await render({ ...flowSettings, flowStrength: scalar(0) });
			assert(flowInitial.some((value, index) => Math.abs(value - unwarped[index]) > 0.002), 'Flow Strength warps later octaves');
			compare(await render({ ...flowSettings, octaves: 1 }), await render({ ...flowSettings, octaves: 1, flowStrength: scalar(0) }), 'Flow first octave is unwarped');
			compare(await render({ ...flowSettings, gain: scalar(0) }), await render({ ...flowSettings, octaves: 1 }), 'Flow zero gain is unwarped');
			compare(await render({ ...flowSettings, flowStrength: scalar(-1) }), unwarped, 'Flow negative strength becomes zero');
			for (const noiseType of ['value', 'simplex', 'perlin', 'worley'] as const) {
				compare(await render({ noiseType, flowPhase: 0.731, flowStrength: scalar(1) }), await render({ noiseType, flowPhase: 0, flowStrength: scalar(0) }), `${noiseType} ignores Flow parameters`);
			}
			checks.push(`${precisionLabel} Flow warp scope and strength`);

			// 【段間ワープは加工前の基礎ノイズの勾配を使い、回転後の座標系で適用する】
			// 単発ノイズの有限差分で勾配を独立に求め、2段の結果を全Fractal Modeで比較する。
			// これにより解析勾配の正規化、XYZ成分、回転の符号、モードへの不適切な依存を検出する。
			const referenceSample = createEffect(1, 1, supports32bit);
			const baseSettings: Partial<Parameters> = { ...flowSettings, coordinateSource: 'input', density: vector([1, 1]), octaves: 1 };
			const basePoint: [number, number, number] = [-0.17, 0.23, 0.37];
			const baseAt = async (point: readonly number[]) => (await referenceSample({ ...baseSettings, coordinates: vector([point[0], point[1]]), time: point[2] }))[0];
			const first = await baseAt(basePoint);
			const gradient: number[] = [];
			const differenceStep = supports32bit ? 0.005 : 0.02;
			for (let axis = 0; axis < 3; axis++) {
				const before = [...basePoint];
				const after = [...basePoint];
				before[axis] -= differenceStep;
				after[axis] += differenceStep;
				gradient.push((await baseAt(after) - await baseAt(before)) / (2 * differenceStep));
			}
			const warpStrength = 0.2;
			const frequency = 1.7;
			const second = await baseAt([
				basePoint[1] * frequency + warpStrength * gradient[1],
				-basePoint[0] * frequency - warpStrength * gradient[0],
				basePoint[2] * frequency + warpStrength * gradient[2],
			]);
			for (const fractalMode of ['fbm', 'turbulence', 'ridged', 'pingPong'] as const) {
				const transformed = [first, second].map(value => {
					if (fractalMode === 'fbm') return value;
					if (fractalMode === 'turbulence') return Math.abs(2 * value - 1);
					if (fractalMode === 'ridged') return (1 - Math.abs(2 * value - 1)) ** 2;
					const trianglePosition = (2 * value * 2.3) % 2;
					return trianglePosition <= 1 ? trianglePosition : 2 - trianglePosition;
				});
				const settings: Partial<Parameters> = { ...baseSettings, coordinates: vector([basePoint[0], basePoint[1]]), time: basePoint[2],
					fractalMode, flowStrength: scalar(warpStrength), octaves: 2, gain: scalar(0.6), lacunarity: scalar(frequency), octaveRotation: 0.25, pingPongStrength: scalar(2.3) };
				// 有限差分による参照値の近似誤差も含める。32bit非対応環境では差分元も16bitとなる。
				near((await sample(settings))[0], (transformed[0] + 0.6 * transformed[1]) / 1.6, `Flow warped ${fractalMode} octaves`, supports32bit ? 0.003 : 0.015);
			}
			checks.push(`${precisionLabel} Flow raw-gradient warp across fractal modes`);

			// 【Perlinの格子点は中立値、Worleyは既知の最近点までのユークリッド距離になる】
			// hashや探索ループをテストへ複製せず、既知の格子点と固定の距離標本で
			// 別方式への誤った分岐・距離の二乗の返却・負のセルの取り扱いを検出する。
			const random = seedrandom('31');
			const seedOffset = [Math.fround(random() * 256), Math.fround(random() * 256), Math.fround(random() * 256)];
			const at = async (noiseType: Parameters['noiseType'], point: readonly [number, number, number]) => (await sample({
				noiseType, seed: 31, coordinateSource: 'input', density: vector([1, 1]), octaves: 1,
				coordinates: vector([point[0] - seedOffset[0], point[1] - seedOffset[1]]), time: point[2] - seedOffset[2],
			}))[0];
			for (const point of [[0, 0, 0], [1, 0, 0], [1, -2, 3]] as const) near(await at('perlin', point), 0.5, 'Perlin lattice point');
			for (const [point, expected] of [
				[[0, 0, 0], 0],
				[[0.25, 0.5, 0.75], 0.31347554841476677],
				[[-1.25, 2.5, -0.75], 0.2065008314360721],
				[[1.5, -2.25, 3.75], 0.3389173721545002],
			] as const) near(await at('worley', point), expected, 'Worley reference distance');
			const beforeBoundary = await at('worley', [0.3, 0.7, 0.9999]);
			const afterBoundary = await at('worley', [0.3, 0.7, 1.0001]);
			near(beforeBoundary, afterBoundary, 'Worley continuity across time cells');
			checks.push(`${precisionLabel} Perlin lattice and Worley distance samples`);
		}

		// 【Simplex Noise共通化後も既存のSnoiseを描画できる】
		// 既存エフェクトのシェーダー結合とuniformの配置に回帰がないことを実GPUで確認する。
		const resolution = { width: 1, height: 1 };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: false };
		const output = snoiseImplementation.outputTextureFactories.output({ wgpu, resolution });
		const snoiseDefaults = Object.fromEntries(Object.entries(snoiseDefinition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value]));
		const snoise = snoiseImplementation.init({ wgpu, resolution, params: snoiseDefaults, resources: {}, reportStatus: () => {}, fallbackTexture: output });
		const encoder = device.createCommandEncoder();
		snoise.render({ params: snoiseDefaults, commandEncoder: encoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
			outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
			createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
			createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
			createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
		});
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		snoise.dispose();
		output.destroy();
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		checks.push('existing Snoise shader');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
