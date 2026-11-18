import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { createTextRenderer } from '../../src/text-rendering/text-renderer.ts';
import type { TextRenderValues } from '../../src/text-rendering/text-render-values.ts';
import { drawVerticalTextLine } from '@gs/shared/text/vertical-text.ts';
import { layoutText } from '../../src/text-rendering/text-layout.ts';
import { createTextShadowMaskRenderer } from '../../src/text-rendering/text-shadow.ts';

/** Scene原寸で字形を直接描く。切り出し範囲・GPUテクスチャの寸法・GPU合成結果は参照しない。 */
function renderReferenceAlpha(values: TextRenderValues, width: number, height: number) {
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d')!;
	context.textAlign = values.align;
	context.textBaseline = 'alphabetic';
	context.direction = 'ltr';
	context.lineJoin = 'round';
	context.fillStyle = '#fff';
	context.strokeStyle = '#fff';
	const longSide = Math.max(width, height);
	const layout = layoutText({
		...values, fontSize: values.size * longSide, alignment: values.align,
		maxInlineSize: values.writingMode === 'vertical-rl' ? values.maxHeight * height : values.maxWidth * width,
	}, (line, size) => {
		context.font = `${size}px sans-serif`;
		return context.measureText(line);
	});
	if (layout == null) throw new Error('Expected text layout');
	const x = width / 2 + values.position[0] * longSide;
	const y = height / 2 - values.position[1] * longSide;
	const shadowRenderer = createTextShadowMaskRenderer();
	try {
		shadowRenderer.render(context, { x, y, layout, fontFamily: 'sans-serif', alignment: values.align, settings: { blur: values.shadowBlur, offset: values.shadowOffset } });
	} finally {
		shadowRenderer.dispose();
	}
	const shadow = context.getImageData(0, 0, width, height).data;
	context.clearRect(0, 0, width, height);
	context.font = `${layout.fontSize}px sans-serif`;
	context.lineWidth = layout.outlineWidth * 2;
	context.translate(x, y);
	if (values.writingMode === 'vertical-rl') context.rotate(Math.PI / 2);
	context.scale(layout.inlineScale, 1);
	const draw = (stroke: boolean) => {
		for (const [index, line] of layout.lines.entries()) {
			const baseline = layout.firstBaselineOffset + index * layout.lineAdvance;
			if (layout.verticalLines != null) drawVerticalTextLine(context, layout.verticalLines[index], layout.fontSize, baseline, stroke);
			else if (stroke) context.strokeText(line, 0, baseline);
			else context.fillText(line, 0, baseline);
		}
		return context.getImageData(0, 0, width, height).data;
	};
	const fill = draw(false);
	const expanded = draw(true);
	// 輪郭は本体の外側、影は前景の背後。本体・輪郭のalphaが異なるので層の取り違えも検出できる。
	return Uint8ClampedArray.from({ length: width * height }, (_, i) => {
		const index = i * 4 + 3;
		const foreground = fill[index] * values.color[3] + (expanded[index] - fill[index]) * values.outlineColor[3];
		return foreground + shadow[index] * values.shadowColor[3] * (1 - foreground / 255);
	});
}

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
							const encoder = device.createCommandEncoder();
							const image = timeline.render(encoder, values);
							device.queue.submit([encoder.finish()]);
							assert(image.kind === 'texture' && image.region != null, 'Timeline text must retain its crop region');
							if (image.kind !== 'texture' || image.region == null) throw new Error('Missing Timeline texture');
							const expectedAlpha = renderReferenceAlpha(values, width, height);
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
							for (const [index, alpha] of expectedAlpha.entries()) {
								alphaDifference += Math.abs(actual[index * 4 + 3] - alpha);
								alphaSum += alpha;
							}
							assert(alphaSum > 10000, 'Text must produce visible pixels');
							assert(alphaDifference / alphaSum < 0.025, `${writingMode}/${overflow}/${align} ${width}x${height}: cropped mask differs by ${alphaDifference / alphaSum}`);
							checks.push(`${writingMode}/${overflow}/${align} ${width}x${height}`);
							if (width === 320 && overflow === 'none' && align === 'center') previews.push(restored);
						}
					}
				}
			} finally {
				timeline.dispose();
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
