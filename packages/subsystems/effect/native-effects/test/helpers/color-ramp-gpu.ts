import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/colorRamp/_def_.ts';
import implementationNative from '../../src/fx/colorRamp/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { COLOR_RAMP_INTERPOLATIONS, createDefaultColorRamp, evaluatePreparedColorRamp, prepareColorRamp } from '@gs/shared/color-ramp.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type ColorRampInputMode = typeof definition.paramDefs.mode.dataType.options[number];
type ColorRampEffectRepetition = {
	repeatCount: number | { input: ShaderInput; values: readonly number[] };
	repeatMode: ColorRamp['repeatMode'];
};

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supportsFloat32 = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supportsFloat32 ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const resolution = { width: 17, height: 1 };
	const wgpu = { device, enable32bitDataTextures: false, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }) };
	const output = implementation.createTexture('output', { wgpu, resolution });
	// 色域外も比較するため、表示用8bitへ変換せずfloatで読み戻す。
	const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule }, fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] } });
	const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
	const buffer = device.createBuffer({ size: 512, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const scalarTexture = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const rangeTexture = device.createTexture({ size: resolution, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const repeatCountTexture = device.createTexture({ size: resolution, format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const repeatCountSamplingTexture = device.createTexture({ size: [3, 1], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const repeatCountFloat32Texture = supportsFloat32 ? device.createTexture({ size: resolution, format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }) : null;
	const pixels = new Uint8Array(resolution.width * 4);
	const positions = Array.from({ length: resolution.width }, (_, index) => Math.round(index / 16 * 255) / 255);
	positions.forEach((value, index) => { pixels[index * 4] = Math.round(value * 255); pixels[index * 4 + 3] = 255; });
	device.queue.writeTexture({ texture: scalarTexture }, pixels, { bytesPerRow: resolution.width * 4 }, resolution);
	const input = textureShaderInput(scalarTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
	const defaultRepetition = {
		repeatCount: definition.paramDefs.repeatCount.defaultValue,
		repeatMode: definition.paramDefs.repeatMode.defaultValue,
	};
	const defaults = {
		ramp: createDefaultColorRamp(), input: constantShaderInput('scalar', 0), mode: 'clamp' as const,
		repeatCount: constantShaderInput('scalar', defaultRepetition.repeatCount), repeatMode: defaultRepetition.repeatMode,
	};
	const effect = implementation.place(wgpu, resolution);
	const checks: string[] = [];
	async function compare(ramp: ColorRamp, shaderInput: ShaderInput, coordinates: number[], label: string, mode: ColorRampInputMode = 'clamp', repetition: ColorRampEffectRepetition = defaultRepetition) {
		const repeatCount = typeof repetition.repeatCount === 'number'
			? { input: constantShaderInput('scalar', repetition.repeatCount), values: Array<number>(coordinates.length).fill(repetition.repeatCount) }
			: repetition.repeatCount;
		const commandEncoder = device.createCommandEncoder();
		await effect.draw({ params: { ramp, input: shaderInput, mode, repeatCount: repeatCount.input, repeatMode: repetition.repeatMode }, commandEncoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 },
			outputs: { output },
		});
		const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
		pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(3); pass.end();
		commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow: 512 }, resolution);
		device.queue.submit([commandEncoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		try {
			const actual = new Float32Array(buffer.getMappedRange());
			const prepared = prepareColorRamp(ramp);
			// 黒白・Linear sRGBの評価値は参照位置そのものになる。
			// 検証済みのCPU規約で利用側の位置を求めてから、受け取った配色を独立して評価する。
			coordinates.forEach((value, index) => {
				const count = Math.fround(repeatCount.values[index]);
				const repeatedPosition = Number.isFinite(count) && count > 0
					? evaluatePreparedColorRamp(prepareColorRamp({ ...createDefaultColorRamp(), repeatCount: count, repeatMode: repetition.repeatMode }), value)[0]
					: 0;
				evaluatePreparedColorRamp(prepared, repeatedPosition).forEach((component, channel) => {
					if (!Number.isFinite(actual[index * 4 + channel]) || Math.abs(actual[index * 4 + channel] - component) > Math.max(0.001, Math.abs(component) * 0.002)) throw new Error(`${label}: pixel ${index} channel ${channel}: ${actual[index * 4 + channel]} != ${component}`);
				});
			});
		} finally { buffer.unmap(); }
		const error = await device.popErrorScope();
		device.pushErrorScope('validation');
		if (error != null) throw new Error(error.message);
		checks.push(label);
	}
	try {
		if (definition.paramDefs.mode.defaultValue !== 'clamp' || definition.paramDefs.mode.dataType.options.join(',') !== 'clamp,wrap,pingPong') throw new Error('Color Ramp input mode contract');
		if (defaultRepetition.repeatCount !== 1 || defaultRepetition.repeatMode !== 'wrap' || definition.paramDefs.repeatMode.dataType.options.join(',') !== 'wrap,pingPong') throw new Error('Color Ramp effect repetition defaults');
		for (const colorSpace of ['srgb', 'linearSrgb', 'oklab', 'oklch'] as const) for (const interpolation of COLOR_RAMP_INTERPOLATIONS) {
			const ramp: ColorRamp = { colorSpace, interpolation, repeatCount: 1, repeatMode: 'wrap', stops: [
				{ id: 'start', position: 0, color: [1, 0, 0, 0.8] }, { id: 'middle', position: 0.5, color: [0, 1, 0, 0.3] }, { id: 'end', position: 1, color: [0, 0, 1, 0] },
			] };
			await compare(ramp, input, positions, `${colorSpace}/${interpolation}/texture`);
			await compare(ramp, constantShaderInput('scalar', 0.25), positions.map(() => 0.25), `${colorSpace}/${interpolation}/uniform`);
			for (const repeatMode of ['wrap', 'pingPong'] as const) {
				await compare({ ...ramp, repeatCount: 2.5, repeatMode }, input, positions, `${colorSpace}/${interpolation}/${repeatMode}/repeated texture`);
				await compare({ ...ramp, repeatCount: 1.5, repeatMode: repeatMode === 'wrap' ? 'pingPong' : 'wrap' }, input, positions,
					`${colorSpace}/${interpolation}/${repeatMode}/effect and data repetition`, 'clamp', { repeatCount: 2.5, repeatMode });
			}
		}
		// 全経路で、alphaの0と微小値・無彩色の区間ごとの色相補完・同色相の一周を
		// 実際のWGSLで評価する。alpha乗算後のCから無彩色を判定すると透明な有彩色で失敗する。
		const hueCases: { label: string; colors: ColorRamp['stops'][number]['color'][] }[] = [
			{ label: 'hue wrap', colors: [[0.7090230868, 0.4824507734, 0.5882349397, 1], [0.7300260394, 0.4811885705, 0.5173839076, 1]] },
			{ label: 'transparent hue', colors: [[1, 0, 0, 1], [0, 0, 1, 0]] },
			{ label: 'tiny alpha hue', colors: [[1, 0, 0, 1], [0, 0, 1, 1e-6]] },
			{ label: 'transparent start', colors: [[0, 0, 1, 0], [1, 0, 0, 1]] },
			{ label: 'achromatic segments', colors: [[1, 0, 0, 1], [0.5, 0.5, 0.5, 1], [0, 0, 1, 1]] },
			{ label: 'grayscale', colors: [[0, 0, 0, 1], [1, 1, 1, 1]] },
			{ label: 'same hue', colors: [[1, 0, 0, 1], [1, 0, 0, 1]] },
			{ label: 'fully transparent', colors: [[1, 0, 0, 0], [0, 0, 1, 0]] },
		];
		for (const hueInterpolation of ['shorter', 'longer', 'increasing', 'decreasing'] as const) for (const { label, colors } of hueCases) {
			const ramp: ColorRamp = { interpolation: 'linear', colorSpace: 'oklch', hueInterpolation, repeatCount: 1, repeatMode: 'wrap', stops: colors.map((color, index) => ({ id: `stop-${index}`, position: index / (colors.length - 1), color })) };
			await compare(ramp, input, positions, `oklch/${hueInterpolation}/${label}`);
		}
		const ramp = createDefaultColorRamp();
		for (const value of [-1, 0, 0.5, 1, 2]) await compare(ramp, constantShaderInput('scalar', value), positions.map(() => value), `extension ${value}`);
		ramp.stops.push({ id: 'jump', position: 0.5, color: [0, 0, 1, 1] }, { id: 'lastJump', position: 0.5, color: [1, 0, 0, 1] });
		await compare(ramp, constantShaderInput('scalar', 0.5), positions.map(() => 0.5), 'duplicate stop boundary');
		ramp.stops = [ramp.stops[2]];
		await compare(ramp, input, positions, 'buffer shrink and single stop');
		ramp.stops = Array.from({ length: 100 }, (_, index) => ({ id: `stop-${index}`, position: index / 99, color: [index / 99, 0.25, 1 - index / 99, 1] }));
		await compare(ramp, input, positions, 'buffer growth without pipeline replacement');

		// 【入力値の境界処理は0〜1固定で、負値と複数周期にも対応する】
		// 期待座標を既知の値として並べ、GPUと同じ式で計算して誤りを隠さないようにする。
		// 端が0・1でないRampも使い、stopの最小・最大位置で折り返す実装を検出する。
		const modeCases = [
			[-4.25, 0, 0.75, 0.25], [-3, 0, 0, 1], [-2, 0, 0, 0],
			[-1.25, 0, 0.75, 0.75], [-1, 0, 0, 1], [-0.25, 0, 0.75, 0.25],
			[0, 0, 0, 0], [0.25, 0.25, 0.25, 0.25], [0.5, 0.5, 0.5, 0.5],
			[0.75, 0.75, 0.75, 0.75], [1, 1, 0, 1], [1.25, 1, 0.25, 0.75],
			[2, 1, 0, 0], [2.25, 1, 0.25, 0.25], [3, 1, 0, 1],
			[4.25, 1, 0.25, 0.25], [5, 1, 0, 1],
		];
		// alpha=0の入力場でもR成分のスカラーを参照し、色として扱わないことも確認する。
		device.queue.writeTexture({ texture: rangeTexture }, new Float16Array(modeCases.flatMap(([value]) => [value, 0, 0, 0])), { bytesPerRow: resolution.width * 8 }, resolution);
		const rangeInput = textureShaderInput(rangeTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
		const insetRamp: ColorRamp = { colorSpace: 'srgb', repeatCount: 1, repeatMode: 'wrap', interpolation: 'linear', stops: [
			{ id: 'start', position: 0.125, color: [1, 0, 0, 0.75] },
			{ id: 'middle', position: 0.5, color: [0, 1, 0, 0.25] },
			{ id: 'end', position: 0.875, color: [0, 0, 1, 0.5] },
		] };
		for (const interpolation of COLOR_RAMP_INTERPOLATIONS) {
			for (const [index, mode] of definition.paramDefs.mode.dataType.options.entries()) {
				await compare({ ...insetRamp, interpolation }, rangeInput, modeCases.map(values => values[index + 1]), `${mode}/${interpolation}/range texture`, mode);
			}
		}

		// 【定数入力にも同じ方式を適用し、Modeの切り替え後も更新したRampを使う】
		// 全方式をキャッシュした後で対応表を変更し、古いbufferや方式が残る不具合を防ぐ。
		for (const [value, ...coordinates] of modeCases) {
			for (const [index, mode] of definition.paramDefs.mode.dataType.options.entries()) {
				await compare(ramp, constantShaderInput('scalar', value), positions.map(() => coordinates[index]), `${mode}/range uniform ${value}`, mode);
			}
		}
		await compare(insetRamp, rangeInput, modeCases.map(values => values[1]), 'restored clamp with updated ramp');
		// 【繰り返し数の変更はbufferだけを更新し、入力の範囲外処理と順に適用する】
		// 小数回・片道の数え方・右端・1/3のようなf32へ丸められる継ぎ目を実際の画素で照合する。
		// 端にないstopを使うことで、繰り返す領域をstopの最小・最大位置と取り違えないようにする。
		for (const repeatMode of ['wrap', 'pingPong'] as const) {
			for (const repeatCount of [0.5, 1, 1.5, 2, 2.1, 2.5, 3]) {
				const repeatedRamp = { ...insetRamp, repeatCount, repeatMode };
				for (const value of [0, 0.25, 1 / 3, 0.5 - 2 ** -24, 0.5, 0.5 + 2 ** -24, 2 / 3, 0.75, 1]) {
					await compare(repeatedRamp, constantShaderInput('scalar', value), positions.map(() => value), `${repeatMode}/${repeatCount}/repeated uniform ${value}`);
				}
				for (const [index, mode] of definition.paramDefs.mode.dataType.options.entries()) {
					await compare(repeatedRamp, rangeInput, modeCases.map(values => values[index + 1]), `${repeatMode}/${repeatCount}/${mode}/repeated range texture`, mode);
				}
			}
		}
		// 【利用側の繰り返しは、入力範囲を処理した後でデータ側とは別に評価する】
		// 小数回と両方式の組み合わせは、回数の乗算やデータ設定の上書きでは再現できない。
		// 同じインスタンスで値を切り替え、全Input Range Mode・テクスチャ・定数の境界を確認する。
		for (const repeatMode of ['wrap', 'pingPong'] as const) {
			for (const repeatCount of [0.5, 1, 1.5, 2, 2.1, 2.5, 3]) {
				for (const dataRepeatMode of ['wrap', 'pingPong'] as const) {
					const repeatedRamp = { ...insetRamp, repeatCount: 2.5, repeatMode: dataRepeatMode };
					const before = JSON.stringify(repeatedRamp);
					const repetition = { repeatCount, repeatMode };
					for (const [index, mode] of definition.paramDefs.mode.dataType.options.entries()) {
						await compare(repeatedRamp, rangeInput, modeCases.map(values => values[index + 1]),
							`effect ${repeatCount}/${repeatMode}/data ${dataRepeatMode}/${mode}/texture`, mode, repetition);
					}
					for (const value of [1 / 3, 0.5, 2 / 3, 1]) {
						await compare(repeatedRamp, constantShaderInput('scalar', value), positions.map(() => value),
							`effect ${repeatCount}/${repeatMode}/data ${dataRepeatMode}/uniform ${value}`, 'clamp', repetition);
					}
					if (JSON.stringify(repeatedRamp) !== before) throw new Error('Effect repetition changed the authored Color Ramp');
				}
			}
		}
		// 【繰り返し数のスカラー場は画素ごとに読み、定数入力との全4構成で同じ規則を使う】
		// Input Range Modeとデータ側の繰り返しも組み合わせ、回数のノード接続が別の段階に作用する不具合を防ぐ。
		const repeatCounts = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 3.5, 2.5, 2, 1.5, 1, 0.5, 0.25, 3, 2];
		device.queue.writeTexture({ texture: repeatCountTexture }, new Float16Array(repeatCounts), { bytesPerRow: resolution.width * 2 }, resolution);
		const repeatCountInput = textureShaderInput(repeatCountTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
		for (const repeatMode of ['wrap', 'pingPong'] as const) {
			for (const dataRepeatMode of ['wrap', 'pingPong'] as const) {
				const repeatedRamp = { ...insetRamp, repeatCount: 2.5, repeatMode: dataRepeatMode };
				const repetition = { repeatCount: { input: repeatCountInput, values: repeatCounts }, repeatMode };
				for (const [index, mode] of definition.paramDefs.mode.dataType.options.entries()) {
					await compare(repeatedRamp, rangeInput, modeCases.map(values => values[index + 1]), `spatial count/${repeatMode}/data ${dataRepeatMode}/${mode}/texture input`, mode, repetition);
					await compare(repeatedRamp, constantShaderInput('scalar', 1.25), positions.map(() => modeCases[11][index + 1]), `spatial count/${repeatMode}/data ${dataRepeatMode}/${mode}/uniform input`, mode, repetition);
				}
			}
		}
		if (repeatCountFloat32Texture != null) {
			// 32bitの場でも同じ読取経路を使い、16bitへ丸めると失われる小さな差を保つ。
			const counts = positions.map((_, index) => Math.fround(1 + index * 0.00001));
			device.queue.writeTexture({ texture: repeatCountFloat32Texture }, new Float32Array(counts), { bytesPerRow: resolution.width * 4 }, resolution);
			await compare(insetRamp, constantShaderInput('scalar', 1), positions.map(() => 1), 'float32 repeat count field', 'clamp', {
				repeatCount: { input: textureShaderInput(repeatCountFloat32Texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' }), values: counts }, repeatMode: 'wrap',
			});
		}
		// 【繰り返し数の接続に固有のFit・Wrap・Filterを、出力の寸法で適用する】
		// 3×1の回数テクスチャを17×1へ描き、Inputと異なる読取設定と実行中の変更を確認する。
		// 奇数幅同士でcontainの画素中心を揃え、境界ちょうどの参照にGPUごとの丸め誤差が出るのを避ける。
		device.queue.writeTexture({ texture: repeatCountSamplingTexture }, new Float16Array([1, 2, 3]), { bytesPerRow: 6 }, [3, 1]);
		for (const filterMode of ['nearest', 'linear'] as const) {
			const counts = positions.map((_, index) => filterMode === 'nearest'
				? 1 + Math.floor(3 * (index + 0.5) / resolution.width)
				: 1 + Math.max(0, Math.min(2, 3 * (index + 0.5) / resolution.width - 0.5)));
			// samplerの補間精度の差をsRGB変換や繰り返しの継ぎ目で増幅せず、線形な色でFilterを比較する。
			await compare(defaults.ramp, constantShaderInput('scalar', 0.125), positions.map(() => 0.125), `repeat count stretch/${filterMode}`, 'clamp', {
				repeatCount: { input: textureShaderInput(repeatCountSamplingTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode }), values: counts }, repeatMode: 'pingPong',
			});
		}
		// containでは元画像が中央の3画素に収まる。余白だけがWrap設定に従って変わる。
		await compare(insetRamp, input, positions, 'repeat count contain/transparent', 'clamp', {
			repeatCount: { input: textureShaderInput(repeatCountSamplingTexture, { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' }), values: positions.map((_, index) => index >= 7 && index <= 9 ? index - 6 : 0) }, repeatMode: 'wrap',
		});
		await compare(insetRamp, input, positions, 'repeat count contain/clamp', 'clamp', {
			repeatCount: { input: textureShaderInput(repeatCountSamplingTexture, { fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' }), values: positions.map((_, index) => index < 8 ? 1 : index === 8 ? 2 : 3) }, repeatMode: 'wrap',
		});
		// 【0・負値・非有限の回数は定数でも場でも配色の先頭を返す】
		// 位置1を含めて確認し、Wrapの終端保持により0回が最後の色になる不具合を防ぐ。
		// 有効な画素を隣接させ、1画素の不正値で場全体を描画できなくならないことも確かめる。
		const zeroCounts = [0, -1, NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE];
		for (const repeatMode of ['wrap', 'pingPong'] as const) {
			for (const repeatCount of zeroCounts) {
				await compare(insetRamp, input, positions, `zero count uniform ${repeatCount}/${repeatMode}`, 'clamp', { repeatCount, repeatMode });
			}
			const counts = Array.from(new Float16Array(positions.map((_, index) => index % 2 === 0 ? zeroCounts[(index / 2) % zeroCounts.length] : 2.5)));
			device.queue.writeTexture({ texture: repeatCountTexture }, new Float16Array(counts), { bytesPerRow: resolution.width * 2 }, resolution);
			await compare(insetRamp, input, positions, `zero count texture/${repeatMode}/texture input`, 'clamp', { repeatCount: { input: repeatCountInput, values: counts }, repeatMode });
			await compare(insetRamp, constantShaderInput('scalar', 1), positions.map(() => 1), `zero count texture/${repeatMode}/right endpoint`, 'clamp', { repeatCount: { input: repeatCountInput, values: counts }, repeatMode });
		}
		await compare(insetRamp, rangeInput, modeCases.map(values => values[1]), 'restores uniform count after texture and zero counts');
		await compare(insetRamp, constantShaderInput('scalar', 0.25), positions.map(() => 0.25), 'restores both uniform inputs after texture and zero counts');
		return { checks };
	} finally {
		effect.dispose(); buffer.destroy(); output.destroy(); copyTarget.destroy(); scalarTexture.destroy(); rangeTexture.destroy();
		repeatCountTexture.destroy(); repeatCountSamplingTexture.destroy(); repeatCountFloat32Texture?.destroy(); device.destroy();
	}
}
