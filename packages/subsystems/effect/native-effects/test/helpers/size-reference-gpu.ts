import { nativeEffectProbe } from './native-effect-probe.ts';
import { textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import symbolsDefinitionSource from '../../src/fx/symbols/_def_.ts';
import symbolsImplementationNative from '../../src/fx/symbols/_impl_.ts';
import adaptiveBlockGlitchDefinitionSource from '../../src/fx/adaptiveBlockGlitch/_def_.ts';
import adaptiveBlockGlitchImplementationNative from '../../src/fx/adaptiveBlockGlitch/_impl_.ts';
import bitPlaneCorruptionDefinitionSource from '../../src/fx/bitPlaneCorruption/_def_.ts';
import bitPlaneCorruptionImplementationNative from '../../src/fx/bitPlaneCorruption/_impl_.ts';
import blockShiftGlitchDefinitionSource from '../../src/fx/blockShiftGlitch/_def_.ts';
import blockShiftGlitchImplementationNative from '../../src/fx/blockShiftGlitch/_impl_.ts';
import blockShuffleDefinitionSource from '../../src/fx/blockShuffle/_def_.ts';
import blockShuffleImplementationNative from '../../src/fx/blockShuffle/_impl_.ts';
import blurDefinitionSource from '../../src/fx/blur/_def_.ts';
import blurImplementationNative from '../../src/fx/blur/_impl_.ts';
import cellRepeaterDefinitionSource from '../../src/fx/cellRepeater/_def_.ts';
import cellRepeaterImplementationNative from '../../src/fx/cellRepeater/_impl_.ts';
import cellTransformDefinitionSource from '../../src/fx/cellTransform/_def_.ts';
import cellTransformImplementationNative from '../../src/fx/cellTransform/_impl_.ts';
import checkerDefinitionSource from '../../src/fx/checker/_def_.ts';
import checkerImplementationNative from '../../src/fx/checker/_impl_.ts';
import chromaticAberrationDefinitionSource from '../../src/fx/chromaticAberration/_def_.ts';
import chromaticAberrationImplementationNative from '../../src/fx/chromaticAberration/_impl_.ts';
import colorBlocksDefinitionSource from '../../src/fx/colorBlocks/_def_.ts';
import colorBlocksImplementationNative from '../../src/fx/colorBlocks/_impl_.ts';
import contentErrorPropagationDefinitionSource from '../../src/fx/contentErrorPropagation/_def_.ts';
import contentErrorPropagationImplementationNative from '../../src/fx/contentErrorPropagation/_impl_.ts';
import datamoshDefinitionSource from '../../src/fx/datamosh/_def_.ts';
import datamoshImplementationNative from '../../src/fx/datamosh/_impl_.ts';
import decoderCorruptionDefinitionSource from '../../src/fx/decoderCorruption/_def_.ts';
import decoderCorruptionImplementationNative from '../../src/fx/decoderCorruption/_impl_.ts';
import dilateErodeDefinitionSource from '../../src/fx/dilateErode/_def_.ts';
import dilateErodeImplementationNative from '../../src/fx/dilateErode/_impl_.ts';
import frequencyTransplantDefinitionSource from '../../src/fx/frequencyTransplant/_def_.ts';
import frequencyTransplantImplementationNative from '../../src/fx/frequencyTransplant/_impl_.ts';
import glassDefinitionSource from '../../src/fx/glass/_def_.ts';
import glassImplementationNative from '../../src/fx/glass/_impl_.ts';
import gradientDefinitionSource from '../../src/fx/gradient/_def_.ts';
import gradientImplementationNative from '../../src/fx/gradient/_impl_.ts';
import gridDefinitionSource from '../../src/fx/grid/_def_.ts';
import gridImplementationNative from '../../src/fx/grid/_impl_.ts';
import hexGridDefinitionSource from '../../src/fx/hexGrid/_def_.ts';
import hexGridImplementationNative from '../../src/fx/hexGrid/_impl_.ts';
import jpegCompressionDefinitionSource from '../../src/fx/jpegCompression/_def_.ts';
import jpegCompressionImplementationNative from '../../src/fx/jpegCompression/_impl_.ts';
import jpegGlitchDefinitionSource from '../../src/fx/jpegGlitch/_def_.ts';
import jpegGlitchImplementationNative from '../../src/fx/jpegGlitch/_impl_.ts';
import kaleidoscopeDefinitionSource from '../../src/fx/kaleidoscope/_def_.ts';
import kaleidoscopeImplementationNative from '../../src/fx/kaleidoscope/_impl_.ts';
import lcdDefinitionSource from '../../src/fx/lcd/_def_.ts';
import lcdImplementationNative from '../../src/fx/lcd/_impl_.ts';
import meshGradientDefinitionSource from '../../src/fx/meshGradient/_def_.ts';
import meshGradientImplementationNative from '../../src/fx/meshGradient/_impl_.ts';
import metaballsDefinitionSource from '../../src/fx/metaballs/_def_.ts';
import metaballsImplementationNative from '../../src/fx/metaballs/_impl_.ts';
import multiscaleGlitchDefinitionSource from '../../src/fx/multiscaleGlitch/_def_.ts';
import multiscaleGlitchImplementationNative from '../../src/fx/multiscaleGlitch/_impl_.ts';
import neuroNoiseDefinitionSource from '../../src/fx/neuroNoise/_def_.ts';
import neuroNoiseImplementationNative from '../../src/fx/neuroNoise/_impl_.ts';
import pixelateDefinitionSource from '../../src/fx/pixelate/_def_.ts';
import pixelateImplementationNative from '../../src/fx/pixelate/_impl_.ts';
import pointerTrailDefinitionSource from '../../src/fx/pointerTrail/_def_.ts';
import pointerTrailImplementationNative from '../../src/fx/pointerTrail/_impl_.ts';
import polkadotDefinitionSource from '../../src/fx/polkadot/_def_.ts';
import polkadotImplementationNative from '../../src/fx/polkadot/_impl_.ts';
import positionTrailDefinitionSource from '../../src/fx/positionTrail/_def_.ts';
import positionTrailImplementationNative from '../../src/fx/positionTrail/_impl_.ts';
import quadtreeFilterDefinitionSource from '../../src/fx/quadtreeFilter/_def_.ts';
import quadtreeFilterImplementationNative from '../../src/fx/quadtreeFilter/_impl_.ts';
import rainDropsOnWindow1DefinitionSource from '../../src/fx/rainDropsOnWindow1/_def_.ts';
import rainDropsOnWindow1ImplementationNative from '../../src/fx/rainDropsOnWindow1/_impl_.ts';
import rainDropsOnWindow2DefinitionSource from '../../src/fx/rainDropsOnWindow2/_def_.ts';
import rainDropsOnWindow2ImplementationNative from '../../src/fx/rainDropsOnWindow2/_impl_.ts';
import rasterDesyncDefinitionSource from '../../src/fx/rasterDesync/_def_.ts';
import rasterDesyncImplementationNative from '../../src/fx/rasterDesync/_impl_.ts';
import regionTimeShiftDefinitionSource from '../../src/fx/regionTimeShift/_def_.ts';
import regionTimeShiftImplementationNative from '../../src/fx/regionTimeShift/_impl_.ts';
import sdfBooleanDefinitionSource from '../../src/fx/sdfBoolean/_def_.ts';
import sdfBooleanImplementationNative from '../../src/fx/sdfBoolean/_impl_.ts';
import sdfToMaskDefinitionSource from '../../src/fx/sdfToMask/_def_.ts';
import sdfToMaskImplementationNative from '../../src/fx/sdfToMask/_impl_.ts';
import shapeSdfDefinitionSource from '../../src/fx/shapeSdf/_def_.ts';
import shapeSdfImplementationNative from '../../src/fx/shapeSdf/_impl_.ts';
import sineWaveWarpDefinitionSource from '../../src/fx/sineWaveWarp/_def_.ts';
import sineWaveWarpImplementationNative from '../../src/fx/sineWaveWarp/_impl_.ts';
import slidingBlocksDefinitionSource from '../../src/fx/slidingBlocks/_def_.ts';
import slidingBlocksImplementationNative from '../../src/fx/slidingBlocks/_impl_.ts';
import noiseDefinitionSource from '../../src/fx/noise/_def_.ts';
import noiseImplementationNative from '../../src/fx/noise/_impl_.ts';
import streamlinesDefinitionSource from '../../src/fx/streamlines/_def_.ts';
import streamlinesImplementationNative from '../../src/fx/streamlines/_impl_.ts';
import stripeDefinitionSource from '../../src/fx/stripe/_def_.ts';
import stripeImplementationNative from '../../src/fx/stripe/_impl_.ts';
import tearingsDefinitionSource from '../../src/fx/tearings/_def_.ts';
import tearingsImplementationNative from '../../src/fx/tearings/_impl_.ts';
import timePatchworkDefinitionSource from '../../src/fx/timePatchwork/_def_.ts';
import timePatchworkImplementationNative from '../../src/fx/timePatchwork/_impl_.ts';
import vectorChromaticAberrationDefinitionSource from '../../src/fx/vectorChromaticAberration/_def_.ts';
import vectorChromaticAberrationImplementationNative from '../../src/fx/vectorChromaticAberration/_impl_.ts';
import vectorFieldVisualizationDefinitionSource from '../../src/fx/vectorFieldVisualization/_def_.ts';
import vectorFieldVisualizationImplementationNative from '../../src/fx/vectorFieldVisualization/_impl_.ts';
import waterDefinitionSource from '../../src/fx/water/_def_.ts';
import waterImplementationNative from '../../src/fx/water/_impl_.ts';
import zoomLinesDefinitionSource from '../../src/fx/zoomLines/_def_.ts';
import zoomLinesImplementationNative from '../../src/fx/zoomLines/_impl_.ts';

const zoomLinesDefinition = { id: 'zoomLines', ...zoomLinesDefinitionSource };
const waterDefinition = { id: 'water', ...waterDefinitionSource };
const vectorFieldVisualizationDefinition = { id: 'vectorFieldVisualization', ...vectorFieldVisualizationDefinitionSource };
const vectorChromaticAberrationDefinition = { id: 'vectorChromaticAberration', ...vectorChromaticAberrationDefinitionSource };
const timePatchworkDefinition = { id: 'timePatchwork', ...timePatchworkDefinitionSource };
const tearingsDefinition = { id: 'tearings', ...tearingsDefinitionSource };
const stripeDefinition = { id: 'stripe', ...stripeDefinitionSource };
const streamlinesDefinition = { id: 'streamlines', ...streamlinesDefinitionSource };
const noiseDefinition = { id: 'noise', ...noiseDefinitionSource };
const slidingBlocksDefinition = { id: 'slidingBlocks', ...slidingBlocksDefinitionSource };
const sineWaveWarpDefinition = { id: 'sineWaveWarp', ...sineWaveWarpDefinitionSource };
const shapeSdfDefinition = { id: 'shapeSdf', ...shapeSdfDefinitionSource };
const sdfToMaskDefinition = { id: 'sdfToMask', ...sdfToMaskDefinitionSource };
const sdfBooleanDefinition = { id: 'sdfBoolean', ...sdfBooleanDefinitionSource };
const regionTimeShiftDefinition = { id: 'regionTimeShift', ...regionTimeShiftDefinitionSource };
const rasterDesyncDefinition = { id: 'rasterDesync', ...rasterDesyncDefinitionSource };
const rainDropsOnWindow2Definition = { id: 'rainDropsOnWindow2', ...rainDropsOnWindow2DefinitionSource };
const rainDropsOnWindow1Definition = { id: 'rainDropsOnWindow1', ...rainDropsOnWindow1DefinitionSource };
const quadtreeFilterDefinition = { id: 'quadtreeFilter', ...quadtreeFilterDefinitionSource };
const positionTrailDefinition = { id: 'positionTrail', ...positionTrailDefinitionSource };
const polkadotDefinition = { id: 'polkadot', ...polkadotDefinitionSource };
const pointerTrailDefinition = { id: 'pointerTrail', ...pointerTrailDefinitionSource };
const pixelateDefinition = { id: 'pixelate', ...pixelateDefinitionSource };
const neuroNoiseDefinition = { id: 'neuroNoise', ...neuroNoiseDefinitionSource };
const multiscaleGlitchDefinition = { id: 'multiscaleGlitch', ...multiscaleGlitchDefinitionSource };
const metaballsDefinition = { id: 'metaballs', ...metaballsDefinitionSource };
const meshGradientDefinition = { id: 'meshGradient', ...meshGradientDefinitionSource };
const lcdDefinition = { id: 'lcd', ...lcdDefinitionSource };
const kaleidoscopeDefinition = { id: 'kaleidoscope', ...kaleidoscopeDefinitionSource };
const jpegGlitchDefinition = { id: 'jpegGlitch', ...jpegGlitchDefinitionSource };
const jpegCompressionDefinition = { id: 'jpegCompression', ...jpegCompressionDefinitionSource };
const hexGridDefinition = { id: 'hexGrid', ...hexGridDefinitionSource };
const gridDefinition = { id: 'grid', ...gridDefinitionSource };
const gradientDefinition = { id: 'gradient', ...gradientDefinitionSource };
const glassDefinition = { id: 'glass', ...glassDefinitionSource };
const frequencyTransplantDefinition = { id: 'frequencyTransplant', ...frequencyTransplantDefinitionSource };
const dilateErodeDefinition = { id: 'dilateErode', ...dilateErodeDefinitionSource };
const decoderCorruptionDefinition = { id: 'decoderCorruption', ...decoderCorruptionDefinitionSource };
const datamoshDefinition = { id: 'datamosh', ...datamoshDefinitionSource };
const contentErrorPropagationDefinition = { id: 'contentErrorPropagation', ...contentErrorPropagationDefinitionSource };
const colorBlocksDefinition = { id: 'colorBlocks', ...colorBlocksDefinitionSource };
const chromaticAberrationDefinition = { id: 'chromaticAberration', ...chromaticAberrationDefinitionSource };
const checkerDefinition = { id: 'checker', ...checkerDefinitionSource };
const cellTransformDefinition = { id: 'cellTransform', ...cellTransformDefinitionSource };
const cellRepeaterDefinition = { id: 'cellRepeater', ...cellRepeaterDefinitionSource };
const blurDefinition = { id: 'blur', ...blurDefinitionSource };
const blockShuffleDefinition = { id: 'blockShuffle', ...blockShuffleDefinitionSource };
const blockShiftGlitchDefinition = { id: 'blockShiftGlitch', ...blockShiftGlitchDefinitionSource };
const bitPlaneCorruptionDefinition = { id: 'bitPlaneCorruption', ...bitPlaneCorruptionDefinitionSource };
const adaptiveBlockGlitchDefinition = { id: 'adaptiveBlockGlitch', ...adaptiveBlockGlitchDefinitionSource };
const symbolsDefinition = { id: 'symbols', ...symbolsDefinitionSource };
const symbolsImplementation = nativeEffectProbe(symbolsDefinition, symbolsImplementationNative);
const adaptiveBlockGlitchImplementation = nativeEffectProbe(adaptiveBlockGlitchDefinition, adaptiveBlockGlitchImplementationNative);
const bitPlaneCorruptionImplementation = nativeEffectProbe(bitPlaneCorruptionDefinition, bitPlaneCorruptionImplementationNative);
const blockShiftGlitchImplementation = nativeEffectProbe(blockShiftGlitchDefinition, blockShiftGlitchImplementationNative);
const blockShuffleImplementation = nativeEffectProbe(blockShuffleDefinition, blockShuffleImplementationNative);
const blurImplementation = nativeEffectProbe(blurDefinition, blurImplementationNative);
const cellRepeaterImplementation = nativeEffectProbe(cellRepeaterDefinition, cellRepeaterImplementationNative);
const cellTransformImplementation = nativeEffectProbe(cellTransformDefinition, cellTransformImplementationNative);
const checkerImplementation = nativeEffectProbe(checkerDefinition, checkerImplementationNative);
const chromaticAberrationImplementation = nativeEffectProbe(chromaticAberrationDefinition, chromaticAberrationImplementationNative);
const colorBlocksImplementation = nativeEffectProbe(colorBlocksDefinition, colorBlocksImplementationNative);
const contentErrorPropagationImplementation = nativeEffectProbe(contentErrorPropagationDefinition, contentErrorPropagationImplementationNative);
const datamoshImplementation = nativeEffectProbe(datamoshDefinition, datamoshImplementationNative);
const decoderCorruptionImplementation = nativeEffectProbe(decoderCorruptionDefinition, decoderCorruptionImplementationNative);
const dilateErodeImplementation = nativeEffectProbe(dilateErodeDefinition, dilateErodeImplementationNative);
const frequencyTransplantImplementation = nativeEffectProbe(frequencyTransplantDefinition, frequencyTransplantImplementationNative);
const glassImplementation = nativeEffectProbe(glassDefinition, glassImplementationNative);
const gradientImplementation = nativeEffectProbe(gradientDefinition, gradientImplementationNative);
const gridImplementation = nativeEffectProbe(gridDefinition, gridImplementationNative);
const hexGridImplementation = nativeEffectProbe(hexGridDefinition, hexGridImplementationNative);
const jpegCompressionImplementation = nativeEffectProbe(jpegCompressionDefinition, jpegCompressionImplementationNative);
const jpegGlitchImplementation = nativeEffectProbe(jpegGlitchDefinition, jpegGlitchImplementationNative);
const kaleidoscopeImplementation = nativeEffectProbe(kaleidoscopeDefinition, kaleidoscopeImplementationNative);
const lcdImplementation = nativeEffectProbe(lcdDefinition, lcdImplementationNative);
const meshGradientImplementation = nativeEffectProbe(meshGradientDefinition, meshGradientImplementationNative);
const metaballsImplementation = nativeEffectProbe(metaballsDefinition, metaballsImplementationNative);
const multiscaleGlitchImplementation = nativeEffectProbe(multiscaleGlitchDefinition, multiscaleGlitchImplementationNative);
const neuroNoiseImplementation = nativeEffectProbe(neuroNoiseDefinition, neuroNoiseImplementationNative);
const pixelateImplementation = nativeEffectProbe(pixelateDefinition, pixelateImplementationNative);
const pointerTrailImplementation = nativeEffectProbe(pointerTrailDefinition, pointerTrailImplementationNative);
const polkadotImplementation = nativeEffectProbe(polkadotDefinition, polkadotImplementationNative);
const positionTrailImplementation = nativeEffectProbe(positionTrailDefinition, positionTrailImplementationNative);
const quadtreeFilterImplementation = nativeEffectProbe(quadtreeFilterDefinition, quadtreeFilterImplementationNative);
const rainDropsOnWindow1Implementation = nativeEffectProbe(rainDropsOnWindow1Definition, rainDropsOnWindow1ImplementationNative);
const rainDropsOnWindow2Implementation = nativeEffectProbe(rainDropsOnWindow2Definition, rainDropsOnWindow2ImplementationNative);
const rasterDesyncImplementation = nativeEffectProbe(rasterDesyncDefinition, rasterDesyncImplementationNative);
const regionTimeShiftImplementation = nativeEffectProbe(regionTimeShiftDefinition, regionTimeShiftImplementationNative);
const sdfBooleanImplementation = nativeEffectProbe(sdfBooleanDefinition, sdfBooleanImplementationNative);
const sdfToMaskImplementation = nativeEffectProbe(sdfToMaskDefinition, sdfToMaskImplementationNative);
const shapeSdfImplementation = nativeEffectProbe(shapeSdfDefinition, shapeSdfImplementationNative);
const sineWaveWarpImplementation = nativeEffectProbe(sineWaveWarpDefinition, sineWaveWarpImplementationNative);
const slidingBlocksImplementation = nativeEffectProbe(slidingBlocksDefinition, slidingBlocksImplementationNative);
const noiseImplementation = nativeEffectProbe(noiseDefinition, noiseImplementationNative);
const streamlinesImplementation = nativeEffectProbe(streamlinesDefinition, streamlinesImplementationNative);
const stripeImplementation = nativeEffectProbe(stripeDefinition, stripeImplementationNative);
const tearingsImplementation = nativeEffectProbe(tearingsDefinition, tearingsImplementationNative);
const timePatchworkImplementation = nativeEffectProbe(timePatchworkDefinition, timePatchworkImplementationNative);
const vectorChromaticAberrationImplementation = nativeEffectProbe(vectorChromaticAberrationDefinition, vectorChromaticAberrationImplementationNative);
const vectorFieldVisualizationImplementation = nativeEffectProbe(vectorFieldVisualizationDefinition, vectorFieldVisualizationImplementationNative);
const waterImplementation = nativeEffectProbe(waterDefinition, waterImplementationNative);
const zoomLinesImplementation = nativeEffectProbe(zoomLinesDefinition, zoomLinesImplementationNative);

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
	[noiseDefinition, noiseImplementation],
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
	const wgpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }), enable32bitDataTextures: false };
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
			// 配列・構造体も含め、試行で上書きしない値はnativeEffectProbeが定義から補う。
			const params: Record<string, unknown> = {};
			// 画像を読む経路も実行し、uniform入力だけでは隠れるbindingの不整合を検出する。
			if ('input' in definition.paramDefs) params.input = textureShaderInput(fallbackTexture, { fitMode: 'contain', wrapMode: 'repeat', filterMode: 'nearest' });
			for (const [name, value] of Object.entries({ blockSize: 25, maxBlockSize: 25, subdivisions: 1, analysisResolution: 32, steps: 2, maximumSteps: 16, historyFrames: 2, samples: 4, blurSamples: 4, aberrationSamples: 3, reset: true })) {
				if (name in definition.paramDefs) params[name] = value;
			}
			const outputs = Object.fromEntries(Object.keys(definition.outputDefs).map(port => {
				const texture = implementation.createTexture(port, { wgpu, resolution });
				return [port, texture];
			}));
			const effect = implementation.place(wgpu, resolution);
			const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
			const bytesPerRow = width * 16;
			const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
			try {
				for (const sizeReference of ['height', 'width', 'shortSide', 'longSide']) {
					params.sizeReference = sizeReference;
					const encoder = device.createCommandEncoder();
					await effect.draw({ params, commandEncoder: encoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0.1, y: 0 }, outputs });
					device.queue.submit([encoder.finish()]);
					for (const [port, output] of Object.entries(outputs)) {
						const copy = device.createCommandEncoder();
						const pass = copy.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
						pass.setPipeline(reader);
						pass.setBindGroup(0, device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: effect.output(port).createView() }] }));
						pass.draw(3); pass.end();
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
				for (const output of Object.values(outputs)) { output.destroy(); }
			}
		}
		return { checks };
	} finally { fallbackTexture.destroy(); device.destroy(); }
}
