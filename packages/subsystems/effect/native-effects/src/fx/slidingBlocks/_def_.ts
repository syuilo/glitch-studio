import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Sliding Blocks',
	summary: {
		'ja-JP': '動いた領域を過去画像のブロックとして切り出し、その画像を保持したまま滑らせます。',
		'en-US': 'Detaches moving regions as frozen image blocks and lets them slide independently.',
	},
	kind: 'modify',
	// 入力が静止していても、発生済みの断片の位置・寿命・減衰を更新する。
	dependsOnRenderHistory: true,
	tags: ['glitch', 'temporal', 'distortion'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: 1 },
		blockSize: { dataType: { kind: 'scalar' }, ui: { label: 'Block Size (% of Reference)', control: { controlType: 'range', min: 1, max: 30, step: 0.1 } }, defaultValue: 8 },
		blockOrigin: {
			dataType: { kind: 'enum', options: ['topLeft', 'center'] },
			ui: { label: 'Block Origin', control: { labels: { topLeft: 'Top Left', center: 'Image Center' } } },
			defaultValue: 'center',
		},
		motionSource: {
			dataType: { kind: 'enum', options: ['input', 'separate'] },
			ui: { label: 'Motion Source', control: { labels: { input: 'Input', separate: 'Separate Motion Input' } } },
			defaultValue: 'input',
		},
		motionInput: { dataType: { kind: 'color' }, ui: { label: 'Motion Input', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] },
		motionSpeedThreshold: { dataType: { kind: 'scalar' }, ui: { label: 'Motion Speed Threshold (% of Reference/s)', control: { controlType: 'range', min: 0, max: 100, step: 0.1 } }, defaultValue: 3 },
		searchRange: { dataType: { kind: 'scalar' }, ui: { label: 'Motion Search Range (% of Reference)', control: { controlType: 'range', min: 0, max: 25, step: 0.1 } }, defaultValue: 8 },
		matchThreshold: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum Motion Match Error', control: { controlType: 'range', min: 0.001, max: 0.5, step: 0.001 } }, defaultValue: 0.15 },
		spawnRate: { dataType: { kind: 'scalar' }, ui: { label: 'Emission Rate (1/s)', control: { controlType: 'range', min: 0, max: 20, step: 0.1 } }, defaultValue: 3 },
		spawnMask: { dataType: { kind: 'scalar' }, ui: { label: 'Emission Mask', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: 1 },
		lifetime: { dataType: { kind: 'scalar' }, ui: { label: 'Lifetime (ms)', control: { controlType: 'range', min: 0, max: 10000, step: 1 } }, defaultValue: 1500 },
		lifetimeRandomness: { dataType: { kind: 'scalar' }, ui: { label: 'Lifetime Randomness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: 0.3 },
		velocityStrength: { dataType: { kind: 'scalar' }, ui: { label: 'Inherited Motion Strength', control: { controlType: 'range', min: -4, max: 4, step: 0.01 } }, defaultValue: 1.5 },
		motionRotation: { dataType: { kind: 'scalar' }, ui: { label: 'Motion Rotation', control: { controlType: 'angle' } }, defaultValue: 0 },
		driftSpeed: { dataType: { kind: 'scalar' }, ui: { label: 'Random Drift Speed (% of Reference/s)', control: { controlType: 'range', min: 0, max: 100, step: 0.1 } }, defaultValue: 5 },
		drag: { dataType: { kind: 'scalar' }, ui: { label: 'Drag (1/s)', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: 0.5 },
		cooldown: { dataType: { kind: 'scalar' }, ui: { label: 'Emission Cooldown (ms)', control: { controlType: 'range', min: 0, max: 5000, step: 1 } }, defaultValue: 250 },
		fadeOut: { dataType: { kind: 'scalar' }, ui: { label: 'Fade Out (Lifetime Fraction)', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: 0.3 },
		background: {
			dataType: { kind: 'enum', options: ['input', 'cutout', 'transparent'] },
			ui: { label: 'Background', control: { labels: { input: 'Live Input', cutout: 'Cut Out Detached Blocks', transparent: 'Transparent' } } },
			defaultValue: 'input',
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset Blocks', control: {} }, defaultValue: false },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
