import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import symbolsDefinition from '../../src/fx/symbols/_def_.ts';
import symbolsImplementation from '../../src/fx/symbols/_impl_.ts';
import adaptiveBlockGlitchDefinition from '../../src/fx/adaptiveBlockGlitch/_def_.ts';
import adaptiveBlockGlitchImplementation from '../../src/fx/adaptiveBlockGlitch/_impl_.ts';
import bitPlaneCorruptionDefinition from '../../src/fx/bitPlaneCorruption/_def_.ts';
import bitPlaneCorruptionImplementation from '../../src/fx/bitPlaneCorruption/_impl_.ts';
import blockShiftGlitchDefinition from '../../src/fx/blockShiftGlitch/_def_.ts';
import blockShiftGlitchImplementation from '../../src/fx/blockShiftGlitch/_impl_.ts';
import blockShuffleDefinition from '../../src/fx/blockShuffle/_def_.ts';
import blockShuffleImplementation from '../../src/fx/blockShuffle/_impl_.ts';
import blurDefinition from '../../src/fx/blur/_def_.ts';
import blurImplementation from '../../src/fx/blur/_impl_.ts';
import cellRepeaterDefinition from '../../src/fx/cellRepeater/_def_.ts';
import cellRepeaterImplementation from '../../src/fx/cellRepeater/_impl_.ts';
import cellTransformDefinition from '../../src/fx/cellTransform/_def_.ts';
import cellTransformImplementation from '../../src/fx/cellTransform/_impl_.ts';
import checkerDefinition from '../../src/fx/checker/_def_.ts';
import checkerImplementation from '../../src/fx/checker/_impl_.ts';
import chromaticAberrationDefinition from '../../src/fx/chromaticAberration/_def_.ts';
import chromaticAberrationImplementation from '../../src/fx/chromaticAberration/_impl_.ts';
import colorBlocksDefinition from '../../src/fx/colorBlocks/_def_.ts';
import colorBlocksImplementation from '../../src/fx/colorBlocks/_impl_.ts';
import contentErrorPropagationDefinition from '../../src/fx/contentErrorPropagation/_def_.ts';
import contentErrorPropagationImplementation from '../../src/fx/contentErrorPropagation/_impl_.ts';
import datamoshDefinition from '../../src/fx/datamosh/_def_.ts';
import datamoshImplementation from '../../src/fx/datamosh/_impl_.ts';
import decoderCorruptionDefinition from '../../src/fx/decoderCorruption/_def_.ts';
import decoderCorruptionImplementation from '../../src/fx/decoderCorruption/_impl_.ts';
import dilateErodeDefinition from '../../src/fx/dilateErode/_def_.ts';
import dilateErodeImplementation from '../../src/fx/dilateErode/_impl_.ts';
import frequencyTransplantDefinition from '../../src/fx/frequencyTransplant/_def_.ts';
import frequencyTransplantImplementation from '../../src/fx/frequencyTransplant/_impl_.ts';
import glassDefinition from '../../src/fx/glass/_def_.ts';
import glassImplementation from '../../src/fx/glass/_impl_.ts';
import gradientDefinition from '../../src/fx/gradient/_def_.ts';
import gradientImplementation from '../../src/fx/gradient/_impl_.ts';
import gridDefinition from '../../src/fx/grid/_def_.ts';
import gridImplementation from '../../src/fx/grid/_impl_.ts';
import hexGridDefinition from '../../src/fx/hexGrid/_def_.ts';
import hexGridImplementation from '../../src/fx/hexGrid/_impl_.ts';
import jpegCompressionDefinition from '../../src/fx/jpegCompression/_def_.ts';
import jpegCompressionImplementation from '../../src/fx/jpegCompression/_impl_.ts';
import jpegGlitchDefinition from '../../src/fx/jpegGlitch/_def_.ts';
import jpegGlitchImplementation from '../../src/fx/jpegGlitch/_impl_.ts';
import kaleidoscopeDefinition from '../../src/fx/kaleidoscope/_def_.ts';
import kaleidoscopeImplementation from '../../src/fx/kaleidoscope/_impl_.ts';
import lcdDefinition from '../../src/fx/lcd/_def_.ts';
import lcdImplementation from '../../src/fx/lcd/_impl_.ts';
import meshGradientDefinition from '../../src/fx/meshGradient/_def_.ts';
import meshGradientImplementation from '../../src/fx/meshGradient/_impl_.ts';
import metaballsDefinition from '../../src/fx/metaballs/_def_.ts';
import metaballsImplementation from '../../src/fx/metaballs/_impl_.ts';
import multiscaleGlitchDefinition from '../../src/fx/multiscaleGlitch/_def_.ts';
import multiscaleGlitchImplementation from '../../src/fx/multiscaleGlitch/_impl_.ts';
import neuroNoiseDefinition from '../../src/fx/neuroNoise/_def_.ts';
import neuroNoiseImplementation from '../../src/fx/neuroNoise/_impl_.ts';
import pixelateDefinition from '../../src/fx/pixelate/_def_.ts';
import pixelateImplementation from '../../src/fx/pixelate/_impl_.ts';
import pointerTrailDefinition from '../../src/fx/pointerTrail/_def_.ts';
import pointerTrailImplementation from '../../src/fx/pointerTrail/_impl_.ts';
import polkadotDefinition from '../../src/fx/polkadot/_def_.ts';
import polkadotImplementation from '../../src/fx/polkadot/_impl_.ts';
import positionTrailDefinition from '../../src/fx/positionTrail/_def_.ts';
import positionTrailImplementation from '../../src/fx/positionTrail/_impl_.ts';
import quadtreeFilterDefinition from '../../src/fx/quadtreeFilter/_def_.ts';
import quadtreeFilterImplementation from '../../src/fx/quadtreeFilter/_impl_.ts';
import rainDropsOnWindow1Definition from '../../src/fx/rainDropsOnWindow1/_def_.ts';
import rainDropsOnWindow1Implementation from '../../src/fx/rainDropsOnWindow1/_impl_.ts';
import rainDropsOnWindow2Definition from '../../src/fx/rainDropsOnWindow2/_def_.ts';
import rainDropsOnWindow2Implementation from '../../src/fx/rainDropsOnWindow2/_impl_.ts';
import rasterDesyncDefinition from '../../src/fx/rasterDesync/_def_.ts';
import rasterDesyncImplementation from '../../src/fx/rasterDesync/_impl_.ts';
import regionTimeShiftDefinition from '../../src/fx/regionTimeShift/_def_.ts';
import regionTimeShiftImplementation from '../../src/fx/regionTimeShift/_impl_.ts';
import sdfBooleanDefinition from '../../src/fx/sdfBoolean/_def_.ts';
import sdfBooleanImplementation from '../../src/fx/sdfBoolean/_impl_.ts';
import sdfToMaskDefinition from '../../src/fx/sdfToMask/_def_.ts';
import sdfToMaskImplementation from '../../src/fx/sdfToMask/_impl_.ts';
import shapeSdfDefinition from '../../src/fx/shapeSdf/_def_.ts';
import shapeSdfImplementation from '../../src/fx/shapeSdf/_impl_.ts';
import sineWaveWarpDefinition from '../../src/fx/sineWaveWarp/_def_.ts';
import sineWaveWarpImplementation from '../../src/fx/sineWaveWarp/_impl_.ts';
import slidingBlocksDefinition from '../../src/fx/slidingBlocks/_def_.ts';
import slidingBlocksImplementation from '../../src/fx/slidingBlocks/_impl_.ts';
import snoiseDefinition from '../../src/fx/snoise/_def_.ts';
import snoiseImplementation from '../../src/fx/snoise/_impl_.ts';
import streamlinesDefinition from '../../src/fx/streamlines/_def_.ts';
import streamlinesImplementation from '../../src/fx/streamlines/_impl_.ts';
import stripeDefinition from '../../src/fx/stripe/_def_.ts';
import stripeImplementation from '../../src/fx/stripe/_impl_.ts';
import tearingsDefinition from '../../src/fx/tearings/_def_.ts';
import tearingsImplementation from '../../src/fx/tearings/_impl_.ts';
import timePatchworkDefinition from '../../src/fx/timePatchwork/_def_.ts';
import timePatchworkImplementation from '../../src/fx/timePatchwork/_impl_.ts';
import vectorChromaticAberrationDefinition from '../../src/fx/vectorChromaticAberration/_def_.ts';
import vectorChromaticAberrationImplementation from '../../src/fx/vectorChromaticAberration/_impl_.ts';
import vectorFieldVisualizationDefinition from '../../src/fx/vectorFieldVisualization/_def_.ts';
import vectorFieldVisualizationImplementation from '../../src/fx/vectorFieldVisualization/_impl_.ts';
import waterDefinition from '../../src/fx/water/_def_.ts';
import waterImplementation from '../../src/fx/water/_impl_.ts';
import zoomLinesDefinition from '../../src/fx/zoomLines/_def_.ts';
import zoomLinesImplementation from '../../src/fx/zoomLines/_impl_.ts';

const effects = [
	[symbolsDefinition, symbolsImplementation],
	[adaptiveBlockGlitchDefinition, adaptiveBlockGlitchImplementation],
	[bitPlaneCorruptionDefinition, bitPlaneCorruptionImplementation],
	[blockShiftGlitchDefinition, blockShiftGlitchImplementation],
	[blockShuffleDefinition, blockShuffleImplementation],
	[blurDefinition, blurImplementation],
	[cellRepeaterDefinition, cellRepeaterImplementation],
	[cellTransformDefinition, cellTransformImplementation],
	[checkerDefinition, checkerImplementation],
	[chromaticAberrationDefinition, chromaticAberrationImplementation],
	[colorBlocksDefinition, colorBlocksImplementation],
	[contentErrorPropagationDefinition, contentErrorPropagationImplementation],
	[datamoshDefinition, datamoshImplementation],
	[decoderCorruptionDefinition, decoderCorruptionImplementation],
	[dilateErodeDefinition, dilateErodeImplementation],
	[frequencyTransplantDefinition, frequencyTransplantImplementation],
	[glassDefinition, glassImplementation],
	[gradientDefinition, gradientImplementation],
	[gridDefinition, gridImplementation],
	[hexGridDefinition, hexGridImplementation],
	[jpegCompressionDefinition, jpegCompressionImplementation],
	[jpegGlitchDefinition, jpegGlitchImplementation],
	[kaleidoscopeDefinition, kaleidoscopeImplementation],
	[lcdDefinition, lcdImplementation],
	[meshGradientDefinition, meshGradientImplementation],
	[metaballsDefinition, metaballsImplementation],
	[multiscaleGlitchDefinition, multiscaleGlitchImplementation],
	[neuroNoiseDefinition, neuroNoiseImplementation],
	[pixelateDefinition, pixelateImplementation],
	[pointerTrailDefinition, pointerTrailImplementation],
	[polkadotDefinition, polkadotImplementation],
	[positionTrailDefinition, positionTrailImplementation],
	[quadtreeFilterDefinition, quadtreeFilterImplementation],
	[rainDropsOnWindow1Definition, rainDropsOnWindow1Implementation],
	[rainDropsOnWindow2Definition, rainDropsOnWindow2Implementation],
	[rasterDesyncDefinition, rasterDesyncImplementation],
	[regionTimeShiftDefinition, regionTimeShiftImplementation],
	[sdfBooleanDefinition, sdfBooleanImplementation],
	[sdfToMaskDefinition, sdfToMaskImplementation],
	[shapeSdfDefinition, shapeSdfImplementation],
	[sineWaveWarpDefinition, sineWaveWarpImplementation],
	[slidingBlocksDefinition, slidingBlocksImplementation],
	[snoiseDefinition, snoiseImplementation],
	[streamlinesDefinition, streamlinesImplementation],
	[stripeDefinition, stripeImplementation],
	[tearingsDefinition, tearingsImplementation],
	[timePatchworkDefinition, timePatchworkImplementation],
	[vectorChromaticAberrationDefinition, vectorChromaticAberrationImplementation],
	[vectorFieldVisualizationDefinition, vectorFieldVisualizationImplementation],
	[waterDefinition, waterImplementation],
	[zoomLinesDefinition, zoomLinesImplementation],
] as const;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	const wgpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: false };
	const checks: string[] = [];
	const reader = device.createRenderPipeline({
		layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});
	const fallbackTexture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	device.queue.writeTexture({ texture: fallbackTexture }, new Uint8Array([100, 150, 200, 255]), { bytesPerRow: 4 }, [1, 1]);
	try {
		for (const [definition, implementation] of effects) for (const [width, height] of [[64, 32], [32, 64]]) {
			device.pushErrorScope('validation');
			const resolution = { width, height };
			const params: Record<string, any> = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]: [string, any]) => {
				const value = parameter.defaultValue.value;
				if (parameter.dataType.kind === 'array') return [name, value.map((element: any) => parameter.element.canNode === true ? constantShaderInput(parameter.dataType.elementType.kind, element.binding.value) : element.binding.value)];
				return [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, value) : value];
			}));
			// 画像を読む経路も実行し、uniform入力だけでは隠れるbindingの不整合を検出する。
			if ('input' in params) params.input = textureShaderInput(fallbackTexture, { fitMode: 'contain', wrapMode: 'repeat', filterMode: 'nearest' });
			for (const [name, value] of Object.entries({ blockSize: 25, maxBlockSize: 25, subdivisions: 1, analysisResolution: 32, steps: 2, maximumSteps: 16, historyFrames: 2, samples: 4, blurSamples: 4, aberrationSamples: 3, reset: true })) {
				if (name in params) params[name] = value;
			}
			const outputs = Object.fromEntries(Object.entries(implementation.outputTextureFactories).map(([name, factory]) => {
				const texture = factory({ wgpu, resolution });
				const previousFrameTexture = factory({ wgpu, resolution });
				return [name, { texture, textureView: texture.createView(), previousFrameTexture, previousFrameTextureView: previousFrameTexture.createView() }];
			}));
			const ready = Promise.withResolvers<void>();
			const effect = implementation.init({ wgpu, resolution, params, resources: {}, fallbackTexture, reportStatus: (status: { type: string; message?: string }) => {
				if (status.type === 'ready') ready.resolve();
				if (status.type === 'error') ready.reject(new Error(status.message));
			} } as any);
			if (definition.id === 'symbols') await ready.promise;
			const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const bytesPerRow = width * 16;
			const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			try {
				for (const sizeReference of ['height', 'width', 'shortSide', 'longSide']) {
					params.sizeReference = sizeReference;
					const encoder = device.createCommandEncoder();
					effect.render({ params, commandEncoder: encoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0.1, y: 0 }, outputDataMap: outputs,
						createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => commandEncoder.beginRenderPass(descriptor),
						createComputePassEncoder: (commandEncoder: GPUCommandEncoder) => commandEncoder.beginComputePass(),
						createPassEncoderFor: (commandEncoder: GPUCommandEncoder, view: GPUTextureView) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
					} as any);
					device.queue.submit([encoder.finish()]);
					for (const [port, output] of Object.entries(outputs)) {
						const copy = device.createCommandEncoder();
						const pass = copy.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
						pass.setPipeline(reader);
						pass.setBindGroup(0, device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.textureView }] }));
						pass.draw(6); pass.end();
						copy.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
						device.queue.submit([copy.finish()]);
						await buffer.mapAsync(GPUMapMode.READ);
						const finite = new Float32Array(buffer.getMappedRange()).every(Number.isFinite);
						buffer.unmap();
						if (!finite) throw new Error(`${definition.id}.${port}: ${sizeReference} produced nonfinite values`);
					}
					checks.push(`${definition.id} ${width}x${height} ${sizeReference}`);
				}
				const error = await device.popErrorScope();
				if (error != null) throw new Error(`${definition.id}: ${error.message}`);
			} catch (error) {
				throw new Error(`${definition.id} ${width}x${height}: ${String(error)}`, { cause: error });
			} finally {
				effect.dispose(); copyTarget.destroy(); buffer.destroy();
				for (const output of Object.values(outputs)) { output.texture.destroy(); output.previousFrameTexture.destroy(); }
			}
		}
		return { checks };
	} finally { fallbackTexture.destroy(); device.destroy(); }
}
