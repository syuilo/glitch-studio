type InputFitMode = 'stretch' | 'cover' | 'contain';
type InputWrapMode = 'repeat' | 'repeatMirrored' | 'clamp' | 'transparent';
type InputFilterMode = 'nearest' | 'linear';

export type ShaderInput =
	| { kind: 'uniform'; value: readonly number[] }
	| { kind: 'texture'; texture: GPUTexture; fitMode: InputFitMode; wrapMode: InputWrapMode; filterMode: InputFilterMode };

export function textureShaderInput(texture: GPUTexture, reference: { fitMode: InputFitMode; wrapMode: InputWrapMode; filterMode: InputFilterMode }): ShaderInput {
	return { kind: 'texture', texture, fitMode: reference.fitMode, wrapMode: reference.wrapMode, filterMode: reference.filterMode };
}

/** 色のリテラルは未乗算。画像入力と同じ意味になる境界で一度だけ乗算する。 */
export function constantShaderInput(dataType: string, value: any): ShaderInput {
	if (dataType === 'color') {
		const alpha = value?.[3] ?? 0;
		return { kind: 'uniform', value: [(value?.[0] ?? 0) * alpha, (value?.[1] ?? 0) * alpha, (value?.[2] ?? 0) * alpha, alpha] };
	}
	if (dataType === 'vector') return { kind: 'uniform', value: [value?.[0] ?? 0, value?.[1] ?? 0] };
	if (dataType === 'scalar') return { kind: 'uniform', value: [value ?? 0] };
	if (dataType === 'any' && value == null) return { kind: 'uniform', value: [0, 0, 0, 0] };
	throw new Error(`Unsupported shader input constant: ${dataType}`);
}

/** 出力座標から入力UVへの逆写像。倍率はフレーム内で共通なのでCPUで求める。 */
export function inputUvScale(input: { width: number; height: number }, output: { width: number; height: number }, fit: InputFitMode): readonly [number, number] {
	const ratio = (input.width / input.height) / (output.width / output.height);
	if (fit === 'cover') return [Math.min(1, 1 / ratio), Math.min(1, ratio)];
	if (fit === 'contain') return [Math.max(1, 1 / ratio), Math.max(1, ratio)];
	return [1, 1];
}

export type ShaderInputType = 'scalar' | 'vector' | 'color' | 'any';
export type ShaderInputSchema = Readonly<Record<string, ShaderInputType | { array: ShaderInputType }>>;
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
	const variantKey = shaderInputVariantKey(schema, inputs);
	const names = new Set(Object.keys(schema));
	for (const name of names) {
		if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) || name.includes('__')) throw new Error(`Invalid shader input name: ${name}`);
	}
	const slots: { name: string; sourceName: string; elementIndex?: number; type: ShaderInputType; index: number; kind: ShaderInput['kind']; textureBinding: number; samplerBinding: number }[] = [];
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
			slots.push({ name, sourceName, elementIndex: typeof type === 'object' ? elementIndex : undefined,
																type: typeof type === 'object' ? type.array : type, index, kind: input.kind,
																textureBinding: index * 2 + 1, samplerBinding: index * 2 + 2 });
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
		schema,
		variantKey,
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
	let previousResources: (GPUTexture | GPUSampler)[] = [];
	let bindGroup: GPUBindGroup;
	return {
		layout,
		update(inputs: ShaderInputValues, output: { width: number; height: number }) {
			if (shaderInputVariantKey(generated.schema, inputs) !== generated.variantKey) throw new Error('Shader input shape or kind changed');
			const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer } }];
			const resources: (GPUTexture | GPUSampler)[] = [];
			values.fill(0);
			for (const slot of generated.slots) {
				const value = inputs[slot.sourceName];
				const input = 'kind' in value ? value : value[slot.elementIndex!];
				if (input.kind !== slot.kind) throw new Error(`Shader input kind changed: ${slot.name}`);
				if (input.kind === 'uniform') {
					values.set(input.value, slot.index * 8);
					continue;
				}
				const scale = inputUvScale(input.texture, output, input.fitMode);
				values.set([...scale, Number(input.filterMode === 'nearest'), Number(input.wrapMode === 'transparent')], slot.index * 8 + 4);
				const samplerKey = `${input.wrapMode}:${input.filterMode}`;
				let sampler = samplers.get(samplerKey);
				if (sampler == null) {
					const addressMode = input.wrapMode === 'repeatMirrored' ? 'mirror-repeat' : input.wrapMode === 'repeat' ? 'repeat' : 'clamp-to-edge';
					sampler = device.createSampler({ minFilter: input.filterMode, magFilter: input.filterMode, addressModeU: addressMode, addressModeV: addressMode });
					samplers.set(samplerKey, sampler);
				}
				resources.push(input.texture, sampler);
				let view = views.get(input.texture);
				if (view == null) {
					view = input.texture.createView();
					views.set(input.texture, view);
				}
				entries.push({ binding: slot.textureBinding, resource: view }, { binding: slot.samplerBinding, resource: sampler });
			}
			device.queue.writeBuffer(buffer, 0, values);
			if (bindGroup == null || resources.some((resource, i) => resource !== previousResources[i])) {
				bindGroup = device.createBindGroup({ layout, entries });
				previousResources = resources;
			}
			return bindGroup;
		},
		dispose: () => buffer.destroy(),
	};
}
