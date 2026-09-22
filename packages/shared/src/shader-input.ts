import type { NodeOutputReference } from './types.ts';

export type InputFitMode = NonNullable<NodeOutputReference['fitMode']>;
export type InputWrapMode = NonNullable<NodeOutputReference['wrapMode']>;
export type ShaderInput =
	| { kind: 'uniform'; value: readonly number[] }
	| { kind: 'texture'; texture: GPUTexture; fitMode: InputFitMode; wrapMode: InputWrapMode };

export function textureShaderInput(texture: GPUTexture, reference: Pick<NodeOutputReference, 'fitMode' | 'wrapMode'> = {}): ShaderInput {
	return { kind: 'texture', texture, fitMode: reference.fitMode ?? 'cover', wrapMode: reference.wrapMode ?? 'repeatMirrored' };
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

export type ShaderInputSchema = Readonly<Record<string, 'scalar' | 'vector' | 'color' | 'any'>>;

/** WGSLとbindingの対応を同時に決定し、エフェクト側の二重管理を避ける。 */
export function generateShaderInputs(schema: ShaderInputSchema, inputs: Record<string, ShaderInput>, group = 0, sampling: 'implicit' | 'level0' = 'implicit') {
	const slots = Object.entries(schema).map(([name, type], index) => {
		if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid shader input name: ${name}`);
		return { name, type, index, kind: inputs[name].kind, textureBinding: index * 2 + 1, samplerBinding: index * 2 + 2 };
	});
	const entries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }];
	const declarations = slots.map(slot => `value_${slot.name}: vec4f, mapping_${slot.name}: vec4f,`).join('\n');
	const functions = slots.map(slot => {
		const { name, type, kind, textureBinding, samplerBinding } = slot;
		const returnType = type === 'scalar' ? 'f32' : type === 'vector' ? 'vec2f' : 'vec4f';
		const swizzle = type === 'scalar' ? '.r' : type === 'vector' ? '.rg' : '';
		if (kind === 'uniform') return `fn read_${name}(position: vec2f) -> ${returnType} { return gs_inputs.value_${name}${swizzle}; }`;
		entries.push(
			{ binding: textureBinding, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
			{ binding: samplerBinding, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
		);
		const sample = sampling === 'implicit'
			? `textureSample(gs_texture_${name}, gs_sampler_${name}, uv)`
			: `textureSampleLevel(gs_texture_${name}, gs_sampler_${name}, uv, 0.0)`;
		return `
@group(${group}) @binding(${textureBinding}) var gs_texture_${name}: texture_2d<f32>;
@group(${group}) @binding(${samplerBinding}) var gs_sampler_${name}: sampler;
fn read_${name}(position: vec2f) -> ${returnType} {
	let mapping = gs_inputs.mapping_${name};
	let uv = position * vec2f(0.5, -0.5) * mapping.xy + 0.5;
	// サンプルは分岐の外で行い、implicit derivativeのuniformityを維持する。
	var value = ${sample};
	// transparentでは透明な隣接画素との線形補間もRGBA全体へ適用する。
	let coverage = clamp(min(uv, 1.0 - uv) * vec2f(textureDimensions(gs_texture_${name})) + 0.5, vec2f(0.0), vec2f(1.0));
	value *= select(1.0, coverage.x * coverage.y, mapping.w != 0.0);
	// fitは座標の対応付けだけを決める。containの余白も指定されたwrapで読む。
	return value${swizzle};
}`;
	}).join('\n');
	return {
		code: `struct GsInputUniforms { ${declarations} };\n@group(${group}) @binding(0) var<uniform> gs_inputs: GsInputUniforms;\n${functions}`,
		entries,
		slots,
		// 各入力はvec4を2つ使い、CPUとWGSLのalignmentを一致させる。
		byteLength: slots.length * 32,
	};
}

/** 生成済みの構成に対応するuniformとbind group。入力テクスチャの所有権は持たない。 */
export function createShaderInputBindings(device: GPUDevice, generated: ReturnType<typeof generateShaderInputs>) {
	const layout = device.createBindGroupLayout({ entries: generated.entries });
	const buffer = device.createBuffer({ size: generated.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const values = new Float32Array(generated.byteLength / 4);
	const samplers = new Map<InputWrapMode, GPUSampler>();
	const views = new WeakMap<GPUTexture, GPUTextureView>();
	let previousResources: (GPUTexture | GPUSampler)[] = [];
	let bindGroup: GPUBindGroup;
	return {
		layout,
		update(inputs: Record<string, ShaderInput>, output: { width: number; height: number }) {
			const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer } }];
			const resources: (GPUTexture | GPUSampler)[] = [];
			values.fill(0);
			for (const slot of generated.slots) {
				const input = inputs[slot.name];
				if (input.kind !== slot.kind) throw new Error(`Shader input kind changed: ${slot.name}`);
				if (input.kind === 'uniform') {
					values.set(input.value, slot.index * 8);
					continue;
				}
				const scale = inputUvScale(input.texture, output, input.fitMode);
				values.set([...scale, 0, Number(input.wrapMode === 'transparent')], slot.index * 8 + 4);
				let sampler = samplers.get(input.wrapMode);
				if (sampler == null) {
					const addressMode = input.wrapMode === 'repeatMirrored' ? 'mirror-repeat' : input.wrapMode === 'repeat' ? 'repeat' : 'clamp-to-edge';
					sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: addressMode, addressModeV: addressMode });
					samplers.set(input.wrapMode, sampler);
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
