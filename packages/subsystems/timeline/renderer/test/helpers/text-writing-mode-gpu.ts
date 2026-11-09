import definition from '@gs/subsystems_effect_shared/fx/text/_def_.ts';
import implementation from '@gs/subsystems_effect_shared/fx/text/_impl_.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createTextRenderer } from '../../src/text-rendering/text-renderer.ts';
import type { TextRenderValues } from '../../src/text-rendering/text-render-values.ts';
import type { RuntimeEffectParameters } from '@gs/subsystems_effect_shared/effect-implementation.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const vertex = device.createShaderModule({ code: vertexCode });
	device.pushErrorScope('validation');
	const checks: string[] = [];
	const previews: OffscreenCanvas[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const readModule = device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	let points = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
	return vec4f(points[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` });
	const readPipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module: readModule }, fragment: { module: readModule, targets: [{ format: 'rgba8unorm' }] } });
	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(readPipeline);
			pass.setBindGroup(0, device.createBindGroup({ layout: readPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3);
			pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Uint8Array(buffer.getMappedRange());
			const pixels = new Uint8ClampedArray(width * height * 4);
			for (let y = 0; y < height; y++) pixels.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
			return pixels;
		} finally {
			buffer.destroy();
			target.destroy();
		}
	}
	try {
		for (const [width, height] of [[480, 320], [320, 480]]) {
			const resolution = { width, height };
			const wgpu = { device, enable32bitDataTextures: false, defaultVertexShaderModule: vertex };
			const output = implementation.outputTextureFactories.output({ wgpu, resolution });
			const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as RuntimeEffectParameters<typeof definition.paramDefs>;
			const effect = implementation.init({ wgpu, resolution, params: defaults, resources: { font: null }, reportStatus: () => {}, fallbackTexture: output });
			const timeline = createTextRenderer({ device, vertex, resolution, fontFileSource: null });
			await timeline.waitUntilReady(new AbortController().signal);
			try {
				for (const writingMode of ['horizontal-tb', 'vertical-rl'] as const) {
					for (const overflow of ['none', 'shrink', 'compress'] as const) {
						for (const align of ['left', 'center', 'right'] as const) {
							const values: TextRenderValues = {
								text: '縦書き「AV 123」。\nかなーか\u3099😀', writingMode, overflow, align,
								size: 0.075, maxWidth: 0.6, maxHeight: 0.6, lineHeight: 1.4,
								position: [0.04, -0.02], color: [1, 1, 1, 0.7], outlineWidth: 0.08, outlineColor: [1, 0.2, 0.1, 0.8],
								shadowEnabled: true, shadowColor: [0.3, 0.5, 1, 0.6], shadowOffset: [0.2, -0.15], shadowBlur: 0.06,
							};
							const params = { ...defaults, ...values, color: constantShaderInput('color', values.color), outlineColor: constantShaderInput('color', values.outlineColor), shadowColor: constantShaderInput('color', values.shadowColor) };
							const encoder = device.createCommandEncoder();
							effect.render({ params, commandEncoder: encoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
								outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
								createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
								createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
								createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
							});
							const image = timeline.render(encoder, values);
							device.queue.submit([encoder.finish()]);
							assert(image.kind === 'texture' && image.region != null, 'Timeline text must retain its crop region');
							if (image.kind !== 'texture' || image.region == null) throw new Error('Missing Timeline texture');
							const expected = await read(output);
							const cropped = new OffscreenCanvas(image.texture.width, image.texture.height);
							cropped.getContext('2d')!.putImageData(new ImageData(await read(image.texture), image.texture.width, image.texture.height), 0, 0);
							const restored = new OffscreenCanvas(width, height);
							const context = restored.getContext('2d')!;
							const { bounds } = image.region;
							context.drawImage(cropped, (bounds.left + 1) * width / 2, (1 - bounds.top) * height / 2,
								(bounds.right - bounds.left) * width / 2, (bounds.top - bounds.bottom) * height / 2);
							const actual = context.getImageData(0, 0, width, height).data;
							// Canvasへ戻すと非乗算色になるため、比較は被覆率のalphaだけを使う。
							let alphaDifference = 0;
							let alphaSum = 0;
							for (let index = 3; index < expected.length; index += 4) {
								alphaDifference += Math.abs(actual[index] - expected[index]);
								alphaSum += expected[index];
							}
							assert(alphaSum > 10000, 'Text must produce visible pixels');
							assert(alphaDifference / alphaSum < 0.025, `${writingMode}/${overflow}/${align} ${width}x${height}: cropped mask differs by ${alphaDifference / alphaSum}`);
							checks.push(`${writingMode}/${overflow}/${align} ${width}x${height}`);
							if (width === 320 && overflow === 'none' && align === 'center') previews.push(restored);
						}
					}
				}
			} finally {
				effect.dispose();
				timeline.dispose();
				output.destroy();
			}
		}
		const preview = new OffscreenCanvas(640, 480);
		const context = preview.getContext('2d')!;
		context.fillStyle = '#17202b';
		context.fillRect(0, 0, 640, 480);
		previews.forEach((canvas, index) => context.drawImage(canvas, index * 320, 0));
		const blob = await preview.convertToBlob({ type: 'image/png' });
		const previewData = await new Promise<string>(resolve => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result).split(',')[1]);
			reader.readAsDataURL(blob);
		});
		const validation = await device.popErrorScope();
		assert(validation == null, validation?.message ?? 'GPU validation error');
		return { checks, preview: previewData };
	} finally {
		device.destroy();
	}
}
