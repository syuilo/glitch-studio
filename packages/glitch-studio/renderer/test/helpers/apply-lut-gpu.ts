import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import { createTestInputs } from '@gs/subsystems_effect_native-effects/test/native-effect-probe.ts';
import definition from '@gs/subsystems_effect_native-effects/fx/applyLut/_def_.ts';
import implementation from '@gs/subsystems_effect_native-effects/fx/applyLut/_impl_.ts';
import { createLutLayout, createLutResources } from '@gs/subsystems_effect_native-effects/fx/applyLut/lut-resources.ts';
import { parseCubeLut } from '@gs/subsystems_effect_native-effects/fx/applyLut/cube.ts';
import { textureShaderInput, type ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { linearSrgbToSrgb, srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32 = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32 ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const completed: string[] = [];
	const vertex = device.createShaderModule({ code: vertexCode });
	// float出力の負値や1超も検証する。検査用コピーは補間せず、同じ画素を厳密に読む。
	const copy = device.createRenderPipeline({
		layout: 'auto',
		vertex: { module: vertex },
		primitive: { topology: 'triangle-list' },
		fragment: {
			targets: [{ format: 'rgba32float' }],
			module: device.createShaderModule({
				code: `
@group(0) @binding(0) var input: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(input, vec2i(p.xy), 0); }`,
			}),
		},
	});
	async function read(texture: GPUTexture) {
		const output = device.createTexture({ size: [1, 1], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(copy);
			pass.setBindGroup(0, device.createBindGroup({ layout: copy.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: 256 }, [1, 1]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const values = [...new Float32Array(buffer.getMappedRange()).slice(0, 4)];
			buffer.unmap();
			return values;
		} finally { output.destroy(); buffer.destroy(); }
	}
	const rows3d = (size: number, transform: (r: number, g: number, b: number) => number[]) => {
		const rows: string[] = [];
		for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
			rows.push(transform(r / (size - 1), g / (size - 1), b / (size - 1)).join(' '));
		}
		return rows.join('\n');
	};
	const identity = 'LUT_3D_SIZE 3\n' + rows3d(3, (r, g, b) => [r, g, b]);
	try {
		for (const use32bit of supports32 ? [false, true] : [false]) {
			const place = (lut: Blob | null, params: Record<string, unknown>) => createEffectInstance({
				effectSource: { type: 'nativeEffect', id: 'applyLut' }, definitions: { getNativeEffect: () => definition }, resolution: { width: 1, height: 1 },
				inputs: createTestInputs(definition.paramDefs, () => params), usedOutputPorts: new Set(['output']), staticSettings: { lut: lut == null ? null : 'table' },
				resources: { assets: lut == null ? [] : [{ id: 'table', name: 'table.cube', fileData: lut, fileDataType: 'application/x-cube-lut', width: 0, height: 0 }], assetTextures: new Map() },
			}, { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: use32bit }, () => implementation);
			let inputTexture: GPUTexture | null = null;
			const draw = async (name: string, text: string | null, rgba: number[], expected: number[], input?: ShaderInput,
				colorSpaces: Partial<Record<'inputColorSpace' | 'outputColorSpace', 'linearSrgb' | 'srgb'>> = {}) => {
				const params = {
					input: input ?? { kind: 'uniform' as const, value: rgba },
					inputColorSpace: 'linearSrgb' as const,
					outputColorSpace: 'linearSrgb' as const,
					...colorSpaces,
				};
				const instance = await place(text == null ? null : new Blob([text]), params);
				try {
					const encoder = device.createCommandEncoder();
					instance.render({ time: 0, timeDelta: 0 }, encoder);
					device.queue.submit([encoder.finish()]);
					const output = instance.outputs.get('output');
					if (output?.kind !== 'texture') throw new Error('Missing LUT output');
					const actual = await read(output.texture);
					if (actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > 0.004)) throw new Error(name + ': ' + actual);
				} finally { instance.dispose(); }
				completed.push(`${name} (${use32bit ? 32 : 16} bit)`);
			};
			try {
				// 【素材の読み込みが完了した配置だけが描画結果を公開できる】
				// 初回・差し替えのどちらも遅延読み込み後の正しい画素を確認する。
				for (const name of ['initial LUT load', 'LUT replacement']) {
					const pending = Promise.withResolvers<string>();
					class DelayedBlob extends Blob { override text() { return pending.promise; } }
					const args = { input: { kind: 'uniform', value: [0.2, 0.6, 0.4, 1] }, inputColorSpace: 'linearSrgb', outputColorSpace: 'linearSrgb' };
					const placement = place(new DelayedBlob(['pending']), args);
					pending.resolve('LUT_1D_SIZE 2\n0 1 0\n1 0 2');
					const instance = await placement;
					try {
						const encoder = device.createCommandEncoder(); instance.render({ time: 0, timeDelta: 0 }, encoder);
						device.queue.submit([encoder.finish()]);
						const output = instance.outputs.get('output');
						if (output?.kind !== 'texture') throw new Error('Missing LUT output');
						const actual = await read(output.texture);
						if (actual.some((value, index) => Math.abs(value - [0.2, 0.4, 0.8, 1][index]) > 0.004)) throw new Error(name + ': ' + actual);
						completed.push(name);
					} finally { instance.dispose(); }
				}
				// 【恒等変換と半透明を実画素で確認する】
				// テクセル中心のずれやpremultiplyの二重適用は、格子の間にある半透明色で検出する。
				await draw('identity translucent', identity, [0.1, 0.3, 0.4, 0.5], [0.1, 0.3, 0.4, 0.5]);
				await draw('transparent', identity, [0, 0, 0, 0], [0, 0, 0, 0]);
				// 【LUTの入力と出力の色空間を独立して変換し、alphaを伝達関数に含めない】
				// 半透明の恒等LUTで片側だけの指定も検証し、両側の誤変換が相殺される見逃しを防ぐ。
				const straight = [0.18, 0.36, 0.72, 0.5];
				const premultiply = (color: number[]) => color.map((value, index) => index < 3 ? value * color[3] : value);
				await draw('sRGB LUT input', identity, premultiply(straight), premultiply(linearSrgbToSrgb(straight)), undefined, { inputColorSpace: 'srgb' });
				await draw('sRGB LUT output', identity, premultiply(straight), premultiply(srgbToLinearSrgb(straight)), undefined, { outputColorSpace: 'srgb' });
				await draw('sRGB LUT round trip', identity, premultiply(straight), premultiply(straight), undefined, { inputColorSpace: 'srgb', outputColorSpace: 'srgb' });
				// 【alphaが0の発光も独立した光の量としてLUTへ渡す】
				// 通常の透明黒の扱いを変えず、unpremultiplyの0除算や再乗算による消失を防ぐ。
				await draw('zero-alpha emission', identity, [0.18, 0.36, 0.72, 0], [0.18, 0.36, 0.72, 0]);
				await draw('bypass preserves HDR', null, [-0.5, 2, 0.25, 1], [-0.5, 2, 0.25, 1]);
				await draw('3D channel order', 'LUT_3D_SIZE 2\n' + rows3d(2, (r, g, b) => [b, r, g]), [0.1, 0.3, 0.4, 0.5], [0.4, 0.1, 0.3, 0.5]);
				await draw('1D independent channels', 'LUT_1D_SIZE 2\n0 1 0\n1 0 2', [0.2, 0.6, 0.4, 1], [0.2, 0.4, 0.8, 1]);
				await draw('domain and clamp', 'LUT_3D_SIZE 2\nDOMAIN_MIN -1 0 1\nDOMAIN_MAX 1 2 3\n' + rows3d(2, (r, g, b) => [r, g, b]), [-2, 1, 4, 1], [0, 0.5, 1, 1]);
				// 【shaperと3Dを各段階の範囲で順に適用する】
				// 一方だけを実行したり、両方に最初の入力を渡す実装ではこの値にならない。
				await draw('combined stages', 'LUT_1D_SIZE 2\nLUT_3D_SIZE 2\nLUT_1D_INPUT_RANGE -1 1\nLUT_3D_INPUT_RANGE 0 2\n2 2 2\n0 0 0\n' + rows3d(2, (r, g, b) => [b, r, g]), [-1, 0, 1, 1], [0, 1, 0.5, 1]);
				await draw('preserves negative and HDR outputs', 'LUT_1D_SIZE 2\n-1 2 0\n1 4 2', [0, 0.5, 1, 1], [-1, 3, 2, 1]);
				// 【長い1D表の折り返し直前と直後を補間する】
				// GPUの幅制限で分けた行をまたいでも、隣り合う2点だけを混ぜる必要がある。
				const size = 65536;
				const boundary = Math.min(device.limits.maxTextureDimension2D, size);
				const longRows = Array.from({ length: size }, (_, i) => i < boundary ? '0 0 0' : '1 1 1');
				const value = (boundary - 0.5) / (size - 1);
				if (boundary < size) await draw('1D row boundary', `LUT_1D_SIZE ${size}\n${longRows.join('\n')}`, [value, value, value, 1], [0.5, 0.5, 0.5, 1]);
				inputTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
				device.queue.writeTexture({ texture: inputTexture }, new Uint8Array([64, 32, 16, 128]), {}, [1, 1]);
				await draw('texture input', identity, [], [64 / 255, 32 / 255, 16 / 255, 128 / 255],
					textureShaderInput(inputTexture, { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' }));
			} finally { inputTexture?.destroy(); }
		}
		// 【GPU制限と16bitの範囲外を明示的なエラーにする】
		// Infinityへ変換して不正な画像を生成するより、精度設定の変更を案内する。
		const layout = createLutLayout(device);
		let rejected = false;
		try { createLutResources(device, layout, false, parseCubeLut('LUT_1D_SIZE 2\n0 0 0\n70000 1 1')); }
		catch (error) { rejected = error instanceof Error && error.message.includes('32-bit'); }
		if (!rejected) throw new Error('Expected half-float overflow rejection');
		completed.push('half-float overflow rejection');
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return completed;
	} finally { device.destroy(); }
}
