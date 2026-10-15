import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'bitPlaneCorruption',
	displayName: 'Bit plane corruption',
	description: {
		'ja-JP': '色の指定したビットを反転・固定・交換して破損を再現します。ビット番号は0が最下位で、交換では指定範囲の両端を入れ替えます。透明度は保持します。',
		'en-US': 'Corrupts selected color bits by inverting, forcing, swapping, or randomizing them. Bit 0 is the least significant bit; Swap exchanges the range endpoints. Preserves alpha.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'glitch', 'pixel', 'stylized'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		mode: {
			dataType: { kind: 'enum', options: ['invert', 'clear', 'set', 'swap', 'randomize'] },
			ui: { label: 'Mode', control: { labels: { invert: 'Invert', clear: 'Force 0', set: 'Force 1', swap: 'Swap first / last bit', randomize: 'Randomize' } } },
			defaultValue: { inputSource: 'literal', value: 'invert' },
		},
		bitDepth: { dataType: { kind: 'scalar' }, ui: { label: 'Bit depth', control: { controlType: 'range', min: 1, max: 16, step: 1 } }, defaultValue: { inputSource: 'literal', value: 8 } },
		firstBit: { dataType: { kind: 'scalar' }, ui: { label: 'First bit (0 = LSB)', control: { controlType: 'range', min: 0, max: 15, step: 1 } }, defaultValue: { inputSource: 'literal', value: 5 } },
		lastBit: { dataType: { kind: 'scalar' }, ui: { label: 'Last bit', control: { controlType: 'range', min: 0, max: 15, step: 1 } }, defaultValue: { inputSource: 'literal', value: 7 } },
		red: { dataType: { kind: 'bool' }, ui: { label: 'Red', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		green: { dataType: { kind: 'bool' }, ui: { label: 'Green', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		blue: { dataType: { kind: 'bool' }, ui: { label: 'Blue', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		sharedErrors: { dataType: { kind: 'bool' }, ui: { label: 'Shared channel errors', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		probability: { dataType: { kind: 'scalar' }, ui: { label: 'Corruption probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.35 } },
		pattern: {
			dataType: { kind: 'enum', options: ['blocks', 'horizontal', 'vertical', 'wholeImage'] },
			ui: { label: 'Corruption pattern', control: { labels: { blocks: 'Blocks', horizontal: 'Horizontal bands', vertical: 'Vertical bands', wholeImage: 'Whole image' } } },
			defaultValue: { inputSource: 'literal', value: 'blocks' },
		},
		density: { dataType: { kind: 'vector' }, ui: { label: 'Density', control: { controlType: 'dimension', min: 1, max: 1000, logarithmic: true } }, canNode: true, defaultValue: { inputSource: 'literal', value: [24, 24] } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Pattern fit mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
