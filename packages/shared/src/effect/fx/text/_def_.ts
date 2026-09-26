import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'text',
	displayName: 'Text',
	tags: ['typography'],
	primaryInputParameter: null,
	paramDefs: {
		text: { dataType: { kind: 'string' }, ui: { label: 'Text', control: {} }, defaultValue: { inputSource: 'literal', value: 'Hello, world!' } },
		font: { dataType: { kind: 'fontAssetReference' }, ui: { label: 'Font', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		size: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Size (height ratio)', control: { controlType: 'range', min: 0, max: 1 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] }, canNode: true },
		position: { dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'xy' } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		align: {
			dataType: { kind: 'enum', options: ['left', 'center', 'right'] },
			ui: { label: 'Alignment', control: { labels: { left: 'Left', center: 'Center', right: 'Right' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		lineHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Line height (size ratio)', control: { controlType: 'range', min: 0, max: 3 } },
			defaultValue: { inputSource: 'literal', value: 1.2 },
		},
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
