import { createFixedInputBindings } from '../../shader-input.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { spatialToNormalizedCoordinates } from '@gs/shared/spatial-coordinate.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues } from '../../multipass.ts';
import { getSizeReferenceLength } from '@gs/shared/size-reference.ts';
import { loadTextFont } from '../../text-font.ts';
import { measureTextPattern, layoutTextPattern } from './layout.ts';
import { packTextPatternAtlas } from './atlas.ts';
import typesCode from './types.wgsl?raw';
import computeCode from './compute.wgsl?raw';
import trackingCode from './tracking.wgsl?raw';
import renderCode from './shader.wgsl?raw';
import type definition from './_def_.ts';
import type { NativeParameterValues } from '../../multipass.ts';

const inputSchema = { tracking: 'scalar', translation: 'vector', opacity: 'scalar', scale: 'scalar', rotation: 'scalar', color: 'color' } as const;
const glyphByteLength = 48;
const instanceByteLength = 64;
const rowByteLength = 8;

const implementation: NativeEffectImplementation<typeof definition.paramDefs, never, typeof definition.staticSettingDefs> = {
	async init(placement) {
		const { device, resolution, inputs, outputTextures, resources } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const font = await loadTextFont(resources.font, placement.signal);
		const canvas = new OffscreenCanvas(1, 1);
		const canvasContext = canvas.getContext('2d');
		if (canvasContext == null) throw new Error('Could not create a Text Pattern canvas.');
		const context = canvasContext;
		const uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformData = new ArrayBuffer(32);
		new Float32Array(uniformData)[0] = resolution.width / resolution.height;
		new Float32Array(uniformData).set(spatialToNormalizedCoordinates([1, 1], resolution), 6);
		const computeLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
			{ binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const trackingPipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
			compute: { module: device.createShaderModule({ code: typesCode + '\n' + trackingCode }), entryPoint: 'applyTracking' },
		});
		const renderLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const renderModule = device.createShaderModule({ code: typesCode + '\n' + renderCode });
		const renderPipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [renderLayout] }),
			vertex: { module: renderModule, entryPoint: 'vs' },
			fragment: { module: renderModule, entryPoint: 'fs', targets: [{
				format: INTERMEDIATE_TEXTURE_FORMAT,
				blend: {
					color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
					alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
				},
			}] },
			primitive: { topology: 'triangle-list' },
		});
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });

		const bindings = createFixedInputBindings(device, inputSchema, params, resolution, 1, 'level0');
		const preparePipeline = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout, bindings.layout] }),
			compute: { module: device.createShaderModule({ code: bindings.code + '\n' + typesCode + '\n' + computeCode }), entryPoint: 'prepareCharacters' },
		});
		const maxInstances = Math.floor(Math.min(device.limits.maxBufferSize / instanceByteLength, device.limits.maxStorageBufferBindingSize / instanceByteLength, device.limits.maxComputeWorkgroupsPerDimension * 64));
		let measurementKey: string | null = null;
		let layoutKey: string | null = null;
		let measurements: ReturnType<typeof measureTextPattern> | null = null;
		let atlas: ReturnType<typeof packTextPatternAtlas> | null = null;
		let atlasTexture: GPUTexture | null = null;
		let glyphBuffer: GPUBuffer | null = null;
		let instanceBuffer: GPUBuffer | null = null;
		let rowBuffer: GPUBuffer | null = null;
		let trackingBuffer: GPUBuffer | null = null;
		let computeGroup: GPUBindGroup | null = null;
		let renderGroup: GPUBindGroup | null = null;
		let capacity = 0;
		let characterCount = 0;
		let rowCapacity = 0;
		let rowCount = 0;

		function updateLayout(values: NativeParameterValues<typeof definition.paramDefs>) {
			const fontSize = values.size * getSizeReferenceLength(values.sizeReference, resolution);
			if (!Number.isFinite(fontSize) || fontSize <= 0) return 0;
			if (fontSize > device.limits.maxTextureDimension2D) throw new Error('Text Pattern glyph atlas exceeds the GPU texture limit.');
			const nextMeasurementKey = JSON.stringify([String(values.text), fontSize]);
			if (measurementKey !== nextMeasurementKey) {
				// 位置・反復数・入力の変化では字形を描き直さない。サイズはCanvasでの基準サイズ、
				// Scaleはキャッシュ済みの字形へのGPU変形として役割を分ける。
				context.font = `${fontSize}px ${font.family}`;
				const nextMeasurements = measureTextPattern(String(values.text), text => context.measureText(text));
				const nextAtlas = packTextPatternAtlas(nextMeasurements.glyphs, device.limits.maxTextureDimension2D);
				canvas.width = nextAtlas.width;
				canvas.height = nextAtlas.height;
				context.font = `${fontSize}px ${font.family}`;
				context.textAlign = 'left';
				context.textBaseline = 'alphabetic';
				context.direction = 'ltr';
				context.fillStyle = '#ffffff';
				for (const [glyph, origin] of nextAtlas.entries) context.fillText(glyph.text, origin.x - glyph.left, origin.y - glyph.top);
				const nextTexture = device.createTexture({ size: [nextAtlas.width, nextAtlas.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
				try {
					device.queue.copyExternalImageToTexture({ source: canvas }, { texture: nextTexture, premultipliedAlpha: true }, [nextAtlas.width, nextAtlas.height]);
				} catch (error) {
					nextTexture.destroy();
					throw error;
				}
				// 準備に失敗した設定から元へ戻しても、以前のキーに別の字形・アトラスを混ぜない。
				// 次のキャッシュが完成してから、対応する計測値・テクスチャをまとめて差し替える。
				atlasTexture?.destroy();
				measurements = nextMeasurements;
				atlas = nextAtlas;
				atlasTexture = nextTexture;
				renderGroup = null;
				measurementKey = nextMeasurementKey;
				layoutKey = null;
			}
			const nextLayoutKey = JSON.stringify([values.repetitions, values.position, values.align, values.lineHeight]);
			if (layoutKey === nextLayoutKey) return characterCount;
			const { characters: placements, rows } = layoutTextPattern(measurements!, { fontSize, repetitions: values.repetitions, position: spatialToNormalizedCoordinates(values.position, resolution), alignment: values.align, lineHeight: values.lineHeight, resolution, maxInstances });
			characterCount = placements.length;
			rowCount = rows.length;
			if (characterCount > 0) {
				if (capacity < characterCount) {
					glyphBuffer?.destroy();
					instanceBuffer?.destroy();
					trackingBuffer?.destroy();
					glyphBuffer = device.createBuffer({ size: characterCount * glyphByteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
					instanceBuffer = device.createBuffer({ size: characterCount * instanceByteLength, usage: GPUBufferUsage.STORAGE });
					trackingBuffer = device.createBuffer({ size: characterCount * Float32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE });
					capacity = characterCount;
					computeGroup = null;
					renderGroup = null;
				}
				if (rowCapacity < rowCount) {
					rowBuffer?.destroy();
					rowBuffer = device.createBuffer({ size: rowCount * rowByteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
					rowCapacity = rowCount;
					computeGroup = null;
				}
				if (computeGroup == null) computeGroup = device.createBindGroup({ layout: computeLayout, entries: [
					{ binding: 0, resource: { buffer: uniforms } },
					{ binding: 1, resource: { buffer: glyphBuffer! } },
					{ binding: 2, resource: { buffer: instanceBuffer! } },
					{ binding: 3, resource: { buffer: rowBuffer! } },
					{ binding: 4, resource: { buffer: trackingBuffer! } },
				] });
				const glyphData = new Float32Array(characterCount * glyphByteLength / 4);
				const centerOffset = (measurements!.descent - measurements!.ascent) / 2;
				for (const [index, placement] of placements.entries()) {
					const { glyph, centerX, centerY } = placement;
					const origin = atlas!.entries.get(glyph);
					// 空白もTrackingの評価点として残すが、頂点は面積0にして描画しない。
					// アトラスにない字形へダミーの画像領域を割り当てる必要はない。
					glyphData.set([
						centerX * 2 / resolution.width - 1, 1 - centerY * 2 / resolution.height, 0, 0,
						(glyph.left - glyph.advance / 2) * 2 / resolution.height, -(glyph.top - centerOffset) * 2 / resolution.height, glyph.width * 2 / resolution.height, -glyph.height * 2 / resolution.height,
						(origin?.x ?? 0) / atlas!.width, (origin?.y ?? 0) / atlas!.height, glyph.width / atlas!.width, glyph.height / atlas!.height,
					], index * glyphByteLength / 4);
				}
				device.queue.writeBuffer(glyphBuffer!, 0, glyphData);
				device.queue.writeBuffer(rowBuffer!, 0, new Uint32Array(rows.flatMap(row => [row.firstCharacter, row.characterCount])));
				if (renderGroup == null) renderGroup = device.createBindGroup({ layout: renderLayout, entries: [
					{ binding: 0, resource: { buffer: uniforms } },
					{ binding: 1, resource: { buffer: instanceBuffer! } },
					{ binding: 2, resource: atlasTexture!.createView() },
					{ binding: 3, resource: sampler },
				] });
				new Uint32Array(uniformData).set([characterCount, rowCount], 1);
				new Float32Array(uniformData).set([fontSize * 2 / resolution.width, values.align === 'left' ? 0 : values.align === 'right' ? 1 : 0.5], 3);
				new Uint32Array(uniformData)[5] = Number(values.align === 'distribute');
				device.queue.writeBuffer(uniforms, 0, uniformData);
			}
			layoutKey = nextLayoutKey;
			return characterCount;
		}

		return {
			cacheKey: 0,
			render: ctx => {
				const count = updateLayout(params);
				if (count > 0) {
					const inputs = bindings.getBindGroup();
					const compute = ctx.commandEncoder.beginComputePass();
					compute.setPipeline(preparePipeline);
					compute.setBindGroup(0, computeGroup);
					compute.setBindGroup(1, inputs);
					compute.dispatchWorkgroups(Math.ceil(count / 64));
					const tracking = params.tracking;
					if (tracking.kind === 'texture' || tracking.value[0] !== 0) {
						compute.setPipeline(trackingPipeline);
						compute.dispatchWorkgroups(Math.ceil(rowCount / 64));
					}
					compute.end();
				}
				// 未準備・空文字列でも必ずclearし、以前の描画を残さない。
				const render = ctx.commandEncoder.beginRenderPass({ colorAttachments: [{ view: outputView, clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
				if (count > 0) {
					render.setPipeline(renderPipeline);
					render.setBindGroup(0, renderGroup);
					render.draw(6, count);
				}
				render.end();
			},
			dispose: () => {
				font.dispose();
				bindings.dispose();
				uniforms.destroy();
				glyphBuffer?.destroy();
				instanceBuffer?.destroy();
				rowBuffer?.destroy();
				trackingBuffer?.destroy();
				atlasTexture?.destroy();
				canvas.width = 1;
				canvas.height = 1;
			},
		};
	},
};

export default implementation;
