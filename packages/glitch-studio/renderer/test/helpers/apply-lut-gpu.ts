import { EffectRenderer } from '@gs/subsystems_effect_renderer/effect-renderer.ts';
import definition from '@gs/subsystems_effect_shared/fx/applyLut/_def_.ts';
import implementation from '@gs/subsystems_effect_shared/fx/applyLut/_impl_.ts';
import { createLutLayout, createLutResources } from '@gs/subsystems_effect_shared/fx/applyLut/lut-resources.ts';
import { parseCubeLut } from '@gs/subsystems_effect_shared/fx/applyLut/cube.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const supports32 = adapter.features.has('float32-filterable');
	const device = await adapter.requestDevice({ requiredFeatures: supports32 ? ['float32-filterable'] : [] });
	device.pushErrorScope('validation');
	const completed: string[] = [];
	const vertex = device.createShaderModule({ code: vertexCode });
	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
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
			pass.draw(6); pass.end();
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
			const renderer = new EffectRenderer({
				definition,
				implementation,
				resolution: { width: 1, height: 1 },
				fallbackTexture,
				wgpu: {
					device,
					defaultVertexShaderModule: vertex,
					enable32bitDataTextures: use32bit,
					intermediateTextureFormat: 'rgba16float',
				},
			});
			let inputTexture: GPUTexture | null = null;
			const draw = async (name: string, text: string | null, rgba: number[], expected: number[], input?: ShaderInput) => {
				const params = {
					input: input ?? { kind: 'uniform' as const, value: rgba },
				};
				renderer.setStaticResources({ lut: text == null ? null : new Blob([text]) });
				renderer.prepare(params);
				if (!await renderer.waitUntilReady(new AbortController().signal)) throw new Error('LUT preparation cancelled');
				const encoder = device.createCommandEncoder();
				renderer.render({
					params,
					commandEncoder: encoder,
					time: 0,
					timeDelta: 0,
					pointerPosition: { x: 0, y: 0 },
					pointerVector: { x: 0, y: 0 },
				});
				device.queue.submit([encoder.finish()]);
				const actual = await read(renderer.getOutputTexture('output')!);
				if (actual.some((value, index) => !Number.isFinite(value) || Math.abs(value - expected[index]) > 0.004)) throw new Error(`${name}: ${actual} != ${expected}`);
				completed.push(`${name} (${use32bit ? 32 : 16} bit)`);
			};
			try {
				// 【Visual Module Live Previewの描画は準備を待たずに開始でき、読み込み完了後に更新される】
				// 書き出しと違いVisual Module Live Previewはprepare/waitUntilReadyを呼ばない。
				// 初回と差し替えの両方で、読み込み中の描画が例外にならず古い画素も残さないことを確認する。
				for (const name of ['initial Visual Module Live Preview load', 'Visual Module Live Preview replacement']) {
					let finishRead!: (text: string) => void;
					const pendingText = new Promise<string>(resolve => { finishRead = resolve; });
					class DelayedBlob extends Blob {
						override text() { return pendingText; }
					}
					renderer.setStaticResources({ lut: new DelayedBlob(['pending']) });
					const params = { input: { kind: 'uniform' as const, value: [0.2, 0.6, 0.4, 1] } };
					const renderVisualModuleLivePreview = () => {
						const encoder = device.createCommandEncoder();
						renderer.render({
							params,
							commandEncoder: encoder,
							time: 0,
							timeDelta: 0,
							pointerPosition: { x: 0, y: 0 },
							pointerVector: { x: 0, y: 0 },
						});
						device.queue.submit([encoder.finish()]);
					};
					renderVisualModuleLivePreview();
					const pendingVersion = renderer.cacheVersion;
					if ((await read(renderer.getOutputTexture('output')!)).some(value => value !== 0)) throw new Error(`${name}: expected transparent output while loading`);
					finishRead('LUT_1D_SIZE 2\n0 1 0\n1 0 2');
					if (!await renderer.waitUntilReady(new AbortController().signal)) throw new Error(`${name}: cancelled`);
					if (renderer.cacheVersion === pendingVersion) throw new Error(`${name}: loading output remained cached`);
					renderVisualModuleLivePreview();
					const actual = await read(renderer.getOutputTexture('output')!);
					if (actual.some((value, index) => Math.abs(value - [0.2, 0.4, 0.8, 1][index]) > 0.004)) throw new Error(`${name}: ${actual}`);
					completed.push(`${name} (${use32bit ? 32 : 16} bit)`);
				}
				// 【恒等変換と半透明を実画素で確認する】
				// テクセル中心のずれやpremultiplyの二重適用は、格子の間にある半透明色で検出する。
				await draw('identity translucent', identity, [0.1, 0.3, 0.4, 0.5], [0.1, 0.3, 0.4, 0.5]);
				await draw('transparent', identity, [0, 0, 0, 0], [0, 0, 0, 0]);
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
				await draw('texture input', identity, [], [64 / 255, 32 / 255, 16 / 255, 128 / 255], {
					kind: 'texture',
					texture: inputTexture,
					fitMode: 'cover',
					wrapMode: 'clamp',
					filterMode: 'linear',
				});
			} finally { renderer.dispose(); inputTexture?.destroy(); }
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
	} finally { fallbackTexture.destroy(); device.destroy(); }
}
