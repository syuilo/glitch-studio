import accumulate from './fx-definitions/accumulate.ts';
import audioWaveform from './fx-definitions/audioWaveform.ts';
import audioSpectrum from './fx-definitions/audioSpectrum.ts';
import audioSpectrogram from './fx-definitions/audioSpectrogram.ts';
import bloom from './fx-definitions/bloom.ts';
import blur from './fx-definitions/blur.ts';
import blockShuffle from './fx-definitions/blockShuffle.ts';
import channelShift from './fx-definitions/channelShift.ts';
import chromaticAberration from './fx-definitions/chromaticAberration.ts';
import colorBlocks from './fx-definitions/colorBlocks.ts';
import fill from './fx-definitions/fill.ts';
import frameDifference from './fx-definitions/frameDifference.ts';
import gradient from './fx-definitions/gradient.ts';
import histogram from './fx-definitions/histogram.ts';
import image from './fx-definitions/image.ts';
import liquidMetal from './fx-definitions/liquidMetal.ts';
import lcd from './fx-definitions/lcd.ts';
import multiply from './fx-definitions/multiply.ts';
import remap from './fx-definitions/remap.ts';
import opticalFlow from './fx-definitions/opticalFlow.ts';
import vectorDisplacement from './fx-definitions/vectorDisplacement.ts';
import pixelSort from './fx-definitions/pixelSort.ts';
import quadtreeFilter from './fx-definitions/quadtreeFilter.ts';
import rainDropsOnWindow1 from './fx-definitions/rainDropsOnWindow1.ts';
import rainDropsOnWindow2 from './fx-definitions/rainDropsOnWindow2.ts';
import rgbTo from './fx-definitions/rgbTo.ts';
import shift from './fx-definitions/shift.ts';
import snoise from './fx-definitions/snoise.ts';
import symbols from './fx-definitions/symbols.ts';
import tearings from './fx-definitions/tearings.ts';
import test from './fx-definitions/test.ts';
import video from './fx-definitions/video.ts';
import water from './fx-definitions/water.ts';
import waveform from './fx-definitions/waveform.ts';
import pointerTrail from './fx-definitions/pointerTrail.ts';
import colorBlend from './fx-definitions/colorBlend.ts';
import colorMix from './fx-definitions/colorMix.ts';
import dataBlend from './fx-definitions/dataBlend.ts';
import dataMix from './fx-definitions/dataMix.ts';
import drosteRegression from './fx-definitions/drosteRegression.ts';
import type { EffectDefinition } from './fx-definition.ts';
import type { FxParamDefs } from '@glitch/shared/types.ts';

const _fxDefinitions = {
	audioWaveform,
	audioSpectrum,
	audioSpectrogram,
	accumulate,
	bloom,
	blur,
	blockShuffle,
	channelShift,
	chromaticAberration,
	colorBlocks,
	fill,
	frameDifference,
	gradient,
	histogram,
	image,
	lcd,
	liquidMetal,
	multiply,
	remap,
	opticalFlow,
	vectorDisplacement,
	pixelSort,
	quadtreeFilter,
	rainDropsOnWindow1,
	rainDropsOnWindow2,
	rgbTo,
	shift,
	snoise,
	symbols,
	tearings,
	test,
	video,
	water,
	waveform,
	pointerTrail,
	colorBlend,
	colorMix,
	dataBlend,
	dataMix,
	drosteRegression,
} as Record<string, Omit<EffectDefinition<any>, 'paramDefs'> & { paramDefs: FxParamDefs }>;

const fxDefinitions = {} as typeof _fxDefinitions;
Object.keys(_fxDefinitions).sort().forEach(key => {
	fxDefinitions[key] = _fxDefinitions[key];
});

export { fxDefinitions };
