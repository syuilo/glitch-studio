import type { UniformOrTexture, UniformValue, TextureValue } from './uniform-or-texture.ts';
import { inputUvScale } from './input-fit.ts';
import type { InputFitMode } from './input-fit.ts';
import type { Resolution } from '../resolution.ts';
export { inputUvScale } from './input-fit.ts';

type InputWrapMode = 'repeat' | 'repeatMirrored' | 'clamp' | 'transparent';
type InputFilterMode = 'nearest' | 'linear';

export type ShaderInputSampling = { fitMode: InputFitMode; wrapMode: InputWrapMode; filterMode: InputFilterMode };

export type TextureShaderInput = Readonly<TextureValue> & {
	/** 配置時の束縛では、GPUTextureが利用可能になる前から入力の寸法を参照する。 */
	readonly resolution: Readonly<Resolution>;
	readonly sampling: Readonly<ShaderInputSampling>;
};

export type ShaderInput = Readonly<UniformValue> | TextureShaderInput;

export function textureShaderInput(texture: GPUTexture, sampling: ShaderInputSampling): TextureShaderInput {
	return { kind: 'texture', texture, resolution: texture, sampling: { ...sampling } };
}

/** スカラーやベクトルをanyで読むときにR/RGテクスチャと揃うよう、欠けた成分だけを補う。 */
function writeUniformComponents(target: number[] | Float32Array, offset: number, components: readonly number[]): void {
	target[offset] = components[0] ?? 0;
	target[offset + 1] = components[1] ?? 0;
	target[offset + 2] = components[2] ?? 0;
	target[offset + 3] = components[3] ?? 1;
}

/** 受け取り側の読み取り設定を付ける。定数をテクスチャ化せず、色の再乗算も行わない。 */
export function toShaderInput(source: UniformOrTexture, sampling: ShaderInputSampling): ShaderInput {
	if (source.kind === 'texture') return textureShaderInput(source.texture, sampling);
	// 受け取り側の型でpremultiplyし直すと色が二重乗算されるため、成分の補完だけを行う。
	const value: number[] = [];
	writeUniformComponents(value, 0, source.value);
	return { kind: 'uniform', value };
}

/** 色のリテラルは未乗算linear sRGB。画像入力と同じ意味になる境界で一度だけ乗算する。 */
export function constantShaderInputComponents(dataType: string, value: any): readonly number[] {
	if (dataType === 'color') {
		const alpha = value?.[3] ?? 0;
		return [(value?.[0] ?? 0) * alpha, (value?.[1] ?? 0) * alpha, (value?.[2] ?? 0) * alpha, alpha];
	}
	if (dataType === 'vector') return [value?.[0] ?? 0, value?.[1] ?? 0];
	if (dataType === 'scalar') return [value ?? 0];
	// anyの4成分はデータなので、第4成分によるpremultiplyを行わない。
	// 未接続や評価失敗のnullも、他の入力型と同様にゼロ値へ変換する。
	if (dataType === 'any') return [value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0, value?.[3] ?? 0];
	throw new Error(`Unsupported shader input constant: ${dataType}`);
}

export function constantShaderInput(dataType: string, value: any): ShaderInput {
	return { kind: 'uniform', value: constantShaderInputComponents(dataType, value) };
}

export type ShaderInputType = 'scalar' | 'vector' | 'color' | 'any';
export type ShaderInputSchema = Readonly<Record<string, ShaderInputType | { array: ShaderInputType }>>;
/** 入力ごとに異なる座標領域でfitする場合の基準寸法。配列入力は共通寸法または要素別の寸法を受け取る。 */
export type ShaderInputReferenceResolutions = Readonly<Partial<Record<string, Resolution | readonly Resolution[]>>>;
// 固定入力でも、受け取り側が描画する領域の寸法や画像端の処理はアニメーションできる。
// 寸法オブジェクトは初期化時に束縛し、各フレームではそのwidth/heightだけを書き換える。
export type ShaderInputSamplingOverrides = {
	readonly referenceResolutions?: ShaderInputReferenceResolutions;
	readonly wrapModes?: Readonly<Record<string, () => InputWrapMode>>;
};

type ShaderInputValue<T extends ShaderInputSchema[string]> = T extends ShaderInputType ? ShaderInput : readonly ShaderInput[];
export type ShaderInputValues<Schema extends ShaderInputSchema = ShaderInputSchema> = {
	readonly [Key in keyof Schema]: ShaderInputValue<Schema[Key]>;
};

// 配列長と各要素の種別も構成に含める。値・接続先・サンプリング設定は含めない。
export function shaderInputVariantKey(schema: ShaderInputSchema, inputs: ShaderInputValues): string {
	return JSON.stringify(Object.entries(schema).map(([name, type]) => {
		const value = inputs[name];
		if (value == null || (typeof type === 'object') !== Array.isArray(value)) throw new Error(`Shader input shape mismatch: ${name}`);
		return 'kind' in value ? value.kind : value.map(input => input.kind);
	}));
}

/** WGSLとbindingの対応を同時に決定し、エフェクト側の二重管理を避ける。 */
export function generateShaderInputs(schema: ShaderInputSchema, inputs: ShaderInputValues, group = 0, sampling: 'implicit' | 'level0' = 'implicit', scalarGradients = false) {
	if (scalarGradients && sampling !== 'level0') throw new Error('Scalar gradients require level0 sampling');
	const names = new Set(Object.keys(schema));
	for (const name of names) {
		if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || name.includes('__')) throw new Error(`Invalid shader input name: ${name}`);
	}
	const slots: { name: string; sourceName: string; elementIndex?: number | null; type: ShaderInputType; index: number; kind: ShaderInput['kind']; textureBinding: number; samplerBinding: number }[] = [];
	const arrays: { name: string; type: ShaderInputType; elements: string[] }[] = [];
	for (const [sourceName, type] of Object.entries(schema)) {
		const value = inputs[sourceName];
		const elements = 'kind' in value ? [value] : value;
		const elementNames: string[] = [];
		for (const [elementIndex, input] of elements.entries()) {
			let name = sourceName;
			if (typeof type === 'object') {
				// 利用側の入力名と衝突しない内部名を選び、配列の各要素に個別bindingを割り当てる。
				name = `gs_element${slots.length}`;
				while (names.has(name)) name += 'x';
				names.add(name);
			}
			const index = slots.length;
			slots.push({
				name,
				sourceName,
				elementIndex: typeof type === 'object' ? elementIndex : null,
				type: typeof type === 'object' ? type.array : type,
				index,
				kind: input.kind,
				textureBinding: index * 2 + 1,
				samplerBinding: index * 2 + 2,
			});
			elementNames.push(name);
		}
		if (typeof type === 'object') arrays.push({ name: sourceName, type: type.array, elements: elementNames });
	}
	const entries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }];
	// 空配列だけでも有効なWGSLのstructと非ゼロサイズのuniformを作る。
	const declarations = slots.map(slot => `value_${slot.name}: vec4f, mapping_${slot.name}: vec4f,`).join('\n') || 'padding: vec4f,';
	const functions = slots.map(slot => {
		const { name, type, kind, textureBinding, samplerBinding } = slot;
		const returnType = type === 'scalar' ? 'f32' : type === 'vector' ? 'vec2f' : 'vec4f';
		const swizzle = type === 'scalar' ? '.r' : type === 'vector' ? '.rg' : '';
		if (kind === 'uniform') return `fn read_${name}(position: vec2f) -> ${returnType} { return gs_inputs.value_${name}${swizzle}; }` + (scalarGradients && type === 'scalar'
			? `\nfn readGradient_${name}(position: vec2f, calculate: bool) -> vec3f { return vec3f(read_${name}(position), 0.0, 0.0); }` : '');
		entries.push(
			{ binding: textureBinding, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
			{ binding: samplerBinding, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
		);
		// 配列の選択先は画素ごとに変わり得るため、配列要素は常に明示LODで読む。
		const sample = sampling === 'implicit' && slot.elementIndex == null
			? `textureSample(gs_texture_${name}, gs_sampler_${name}, uv)`
			: `textureSampleLevel(gs_texture_${name}, gs_sampler_${name}, uv, 0.0)`;
		return `
@group(${group}) @binding(${textureBinding}) var gs_texture_${name}: texture_2d<f32>;
@group(${group}) @binding(${samplerBinding}) var gs_sampler_${name}: sampler;
fn gs_sample_${name}(uv: vec2f) -> ${returnType} {
	let mapping = gs_inputs.mapping_${name};
	// サンプルは分岐の外で行い、implicit derivativeのuniformityを維持する。
	var value = ${sample};
	if (mapping.w != 0.0) {
		if (mapping.z != 0.0) {
			// nearestでは透明な隣接画素を補間せず、範囲外だけ0にする。
			value *= select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv < vec2f(1.0)));
		} else {
			// linearでは透明な隣接画素との補間分をRGBA全体へ適用する。
			let coverage = clamp(min(uv, 1.0 - uv) * vec2f(textureDimensions(gs_texture_${name})) + 0.5, vec2f(0.0), vec2f(1.0));
			value *= coverage.x * coverage.y;
		}
	}
	// fitは座標の対応付けだけを決める。containの余白も指定されたwrapで読む。
	return value${swizzle};
}
fn read_${name}(position: vec2f) -> ${returnType} {
	return gs_sample_${name}(position * vec2f(0.5, -0.5) * gs_inputs.mapping_${name}.xy + 0.5);
}` + (scalarGradients && type === 'scalar' ? `
// 値と画面座標[-1,+1]に対する偏微分。定数uniformの微分は別の生成関数で0にする。
fn readGradient_${name}(position: vec2f, calculate: bool) -> vec3f {
	let scale = gs_inputs.mapping_${name}.xy * vec2f(0.5, -0.5);
	let uv = position * scale + 0.5;
	let value = gs_sample_${name}(uv);
	// nearestは画素内で一定。微分不能な境界も0と定義し、追加サンプルを省略する。
	if (!calculate || gs_inputs.mapping_${name}.z != 0.0) { return vec3f(value, 0.0, 0.0); }
	let size = vec2f(textureDimensions(gs_texture_${name}));
	let pixel = uv * size - 0.5;
	let base = (floor(pixel) + 0.5) / size;
	let weight = fract(pixel);
	// 補間関数の4頂点を読み、双線形補間を解析的に微分する。
	// 同じwrap/透明境界を通すため、repeatの継ぎ目や透明な余白も値と一致する。
	// 1x1でもtransparentの境界では値が変化するので、サイズだけで微分を省略しない。
	let a = gs_sample_${name}(base);
	let b = gs_sample_${name}(base + vec2f(1.0 / size.x, 0.0));
	let c = gs_sample_${name}(base + vec2f(0.0, 1.0 / size.y));
	let d = gs_sample_${name}(base + 1.0 / size);
	let derivative = vec2f(mix(b - a, d - c, weight.y), mix(c - a, d - b, weight.x));
	// fitの倍率とY反転を連鎖律で含める。画素境界では右側の区間の微分を採用する。
	return vec3f(value, derivative * size * scale);
}` : '');
	}).join('\n');
	const selectors = arrays.map(({ name, type, elements }) => {
		const returnType = type === 'scalar' ? 'f32' : type === 'vector' ? 'vec2f' : 'vec4f';
		const selectFunction = (prefix: string, resultType: string, extra = '') => `
fn ${prefix}_${name}(index: u32, position: vec2f${extra}) -> ${resultType} {
	switch index {
		${elements.map((element, index) => `case ${index}u: { return ${prefix}_${element}(position${extra ? ', calculate' : ''}); }`).join('\n')}
		default: { return ${resultType}(0.0); }
	}
}`;
		return `const count_${name}: u32 = ${elements.length}u;\n` + selectFunction('read', returnType)
			+ (scalarGradients && type === 'scalar' ? selectFunction('readGradient', 'vec3f', ', calculate: bool') : '');
	}).join('\n');
	return {
		code: `struct GsInputUniforms { ${declarations} };\n@group(${group}) @binding(0) var<uniform> gs_inputs: GsInputUniforms;\n${functions}\n${selectors}`,
		entries,
		slots,
		// 各入力はvec4を2つ使い、CPUとWGSLのalignmentを一致させる。
		byteLength: Math.max(16, slots.length * 32),
	};
}

/** 生成済みの構成に対応するuniformとbind group。入力テクスチャの所有権は持たない。 */
export function createShaderInputBindings(device: GPUDevice, generated: ReturnType<typeof generateShaderInputs>) {
	const textureCount = generated.slots.filter(slot => slot.kind === 'texture').length;
	// 個別binding方式の上限。内部groupを含む合計の検証はpipeline作成時にもGPUが行う。
	if (textureCount > device.limits?.maxSampledTexturesPerShaderStage || textureCount > device.limits?.maxSamplersPerShaderStage
		|| generated.byteLength > device.limits?.maxUniformBufferBindingSize || generated.entries.length > device.limits?.maxBindingsPerBindGroup) {
		throw new Error(`Shader inputs exceed device binding limits (${textureCount} textures/samplers, ${generated.byteLength} uniform bytes)`);
	}
	const layout = device.createBindGroupLayout({ entries: generated.entries });
	const buffer = device.createBuffer({ size: generated.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const values = new Float32Array(generated.byteLength / 4);
	const samplers = new Map<string, GPUSampler>();
	const views = new WeakMap<GPUTexture, GPUTextureView>();
	const previousResources: (GPUTexture | GPUSampler)[] = [];
	const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer } }];
	let bindGroup: GPUBindGroup;
	let resourcesChanged = true;

	function getSampler(wrapMode: InputWrapMode, filterMode: InputFilterMode): GPUSampler {
		const addressMode = wrapMode === 'repeatMirrored' ? 'mirror-repeat' : wrapMode === 'repeat' ? 'repeat' : 'clamp-to-edge';
		const key = `${addressMode}:${filterMode}`;
		let sampler = samplers.get(key);
		if (sampler == null) {
			sampler = device.createSampler({ minFilter: filterMode, magFilter: filterMode, addressModeU: addressMode, addressModeV: addressMode });
			samplers.set(key, sampler);
		}
		return sampler;
	}

	type Slot = typeof generated.slots[number];

	function setTexture(slot: Slot, resourceIndex: number, texture: GPUTexture, sampler: GPUSampler): void {
		if (previousResources[resourceIndex] === texture && previousResources[resourceIndex + 1] === sampler) return;
		let view = views.get(texture);
		if (view == null) {
			view = texture.createView();
			views.set(texture, view);
		}
		entries[1 + resourceIndex] = { binding: slot.textureBinding, resource: view };
		entries[2 + resourceIndex] = { binding: slot.samplerBinding, resource: sampler };
		previousResources[resourceIndex] = texture;
		previousResources[resourceIndex + 1] = sampler;
		resourcesChanged = true;
	}

	function getBindGroup(): GPUBindGroup {
		if (resourcesChanged) {
			bindGroup = device.createBindGroup({ layout, entries });
			resourcesChanged = false;
		}
		return bindGroup;
	}

	function setFitScale(slot: Slot, sampling: ShaderInputSampling, size: Resolution, reference: Resolution): void {
		const scale = inputUvScale(size, reference, sampling.fitMode);
		const offset = slot.index * 8 + 4;
		values[offset] = scale[0];
		values[offset + 1] = scale[1];
	}

	function setMapping(slot: Slot, sampling: ShaderInputSampling, size: Resolution, reference: Resolution): void {
		setFitScale(slot, sampling, size, reference);
		const offset = slot.index * 8 + 4;
		values[offset + 2] = Number(sampling.filterMode === 'nearest');
		values[offset + 3] = Number(sampling.wrapMode === 'transparent');
	}

	return {
		layout,
		/** 入力の構造・寸法・サンプリングが固定の配置用。実テクスチャは初回描画まで要求しない。 */
		bindFixedInputs(inputs: ShaderInputValues, output: Resolution, overrides?: ShaderInputSamplingOverrides) {
			const uniforms: { input: UniformValue; offset: number }[] = [];
			const textures: { input: TextureValue; slot: Slot; sampler: GPUSampler }[] = [];
			const updateSampling: (() => boolean)[] = [];
			const dynamicSamplerSlots: { sampler: GPUSampler }[] = [];
			for (const slot of generated.slots) {
				const value = inputs[slot.sourceName];
				const input = 'kind' in value ? value : value[slot.elementIndex!];
				if (input.kind === 'uniform') {
					uniforms.push({ input, offset: slot.index * 8 });
				} else {
					const { resolution, sampling } = input;
					setMapping(slot, sampling, resolution, output);
					const textureSlot = { input, slot, sampler: getSampler(sampling.wrapMode, sampling.filterMode) };
					textures.push(textureSlot);
					const references = overrides?.referenceResolutions?.[slot.sourceName];
					const reference = references == null || 'width' in references ? references : references[slot.elementIndex!];
					if (reference != null && sampling.fitMode !== 'stretch') {
						let width = output.width;
						let height = output.height;
						updateSampling.push(() => {
							if (width === reference.width && height === reference.height) return false;
							width = reference.width;
							height = reference.height;
							setFitScale(slot, sampling, resolution, reference);
							return true;
						});
					}
					const wrapMode = overrides?.wrapModes?.[slot.sourceName];
					if (wrapMode != null) {
						dynamicSamplerSlots.push(textureSlot);
						const samplerFor = (wrapMode: InputWrapMode) => getSampler(wrapMode, sampling.filterMode);
						const samplersByWrap = { repeat: samplerFor('repeat'), repeatMirrored: samplerFor('repeatMirrored'),
							clamp: samplerFor('clamp'), transparent: samplerFor('transparent') };
						let previousWrap = sampling.wrapMode;
						updateSampling.push(() => {
							const wrap = wrapMode();
							if (wrap === previousWrap) return false;
							previousWrap = wrap;
							textureSlot.sampler = samplersByWrap[wrap];
							values[slot.index * 8 + 7] = Number(wrap === 'transparent');
							return true;
						});
					}
				}
			}
			if (uniforms.length === 0) device.queue.writeBuffer(buffer, 0, values);
			const uniformGroup = textures.length === 0 ? getBindGroup() : null;
			// 履歴出力は2枚を交互に公開する。入力側でも両方の組合せを保持し、毎フレームのbind group生成を省く。
			// 外部入力は任意のtextureに差し替えられるため、保持する組合せは2件までにする。
			const textureGroups: { textures: GPUTexture[]; samplers: GPUSampler[] | null; group: GPUBindGroup }[] = [];
			const frameTextures: GPUTexture[] = [];
			const matchesFrame = (texture: GPUTexture, index: number) => texture === frameTextures[index];
			const matchesSampler = (sampler: GPUSampler, index: number) => sampler === dynamicSamplerSlots[index].sampler;
			return (): GPUBindGroup => {
				for (const { input, offset } of uniforms) writeUniformComponents(values, offset, input.value);
				let writeUniforms = uniforms.length > 0;
				for (const update of updateSampling) {
					if (update()) writeUniforms = true;
				}
				if (writeUniforms) device.queue.writeBuffer(buffer, 0, values);
				if (uniformGroup != null) return uniformGroup;
				for (let index = 0; index < textures.length; index++) frameTextures[index] = textures[index].input.texture;
				for (const cached of textureGroups) {
					if (cached.textures.every(matchesFrame) && (cached.samplers == null || cached.samplers.every(matchesSampler))) return cached.group;
				}
				for (let index = 0; index < textures.length; index++) {
					const { slot, sampler } = textures[index];
					setTexture(slot, index * 2, frameTextures[index], sampler);
				}
				const group = getBindGroup();
				if (textureGroups.length === 2) textureGroups.shift();
				const samplers = dynamicSamplerSlots.length > 0 ? dynamicSamplerSlots.map(slot => slot.sampler) : null;
				textureGroups.push({ textures: frameTextures.slice(), samplers, group });
				return group;
			};
		},
		update(inputs: ShaderInputValues, output: Resolution, inputReferenceResolutions: ShaderInputReferenceResolutions = {}) {
			// 入力構成に対応するbindingsの選択・再生成は呼び出し側が担当する。
			// ここでは確定済みの配置へ値を転送し、同じ構成キーを毎フレーム再計算しない。
			let resourceIndex = 0;
			values.fill(0);
			for (const slot of generated.slots) {
				const value = inputs[slot.sourceName];
				const input = 'kind' in value ? value : value[slot.elementIndex!];
				if (input.kind === 'uniform') {
					writeUniformComponents(values, slot.index * 8, input.value);
					continue;
				}
				const references = inputReferenceResolutions[slot.sourceName];
				const reference = references == null ? output : 'width' in references ? references : references[slot.elementIndex ?? 0] ?? output;
				const { sampling } = input;
				setMapping(slot, sampling, input.resolution, reference);
				setTexture(slot, resourceIndex, input.texture, getSampler(sampling.wrapMode, sampling.filterMode));
				resourceIndex += 2;
			}
			device.queue.writeBuffer(buffer, 0, values);
			return getBindGroup();
		},
		dispose: () => buffer.destroy(),
	};
}
