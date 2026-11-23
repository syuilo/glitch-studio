import { defineNativeEffect } from '../src/effect-definition.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectParameterLayoutItem } from '../src/effect-parameter-layout.ts';

const scalar = {
	dataType: { kind: 'scalar' },
	ui: { label: 'Value', control: { controlType: 'number' } },
	defaultValue: 0,
} as const;
const input = { ...scalar, canNode: true } as const;
const audio = {
	dataType: { kind: 'audioSource' },
	ui: { label: 'Audio', control: {} },
	defaultValue: null,
} as const;
const group = {
	dataType: { kind: 'struct', fields: { input: scalar.dataType } },
	ui: { label: 'Group', control: { fields: { input: scalar.ui } } },
	fields: { input: { canNode: true, defaultValue: scalar.defaultValue } },
	defaultValue: { input: scalar.defaultValue },
} as const;
const groups = {
	dataType: { kind: 'array', elementType: group.dataType },
	ui: { label: 'Groups', control: { element: group.ui.control } },
	element: { fields: group.fields, defaultValue: group.defaultValue },
	defaultValue: [] as [],
} as const;
const values = {
	dataType: { kind: 'array', elementType: scalar.dataType },
	ui: { label: 'Values', control: { element: scalar.ui.control } },
	element: { defaultValue: scalar.defaultValue },
	defaultValue: [] as [],
} as const;
const definition = {
	displayName: 'Type Test', summary: { 'ja-JP': '型検査用', 'en-US': 'Type test' },
	kind: 'generate', dependsOnRenderHistory: false, tags: [],
	paramDefs: { input, amount: scalar, audio, group, groups, values },
	primaryInputParameter: null, resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output',
} as const;

// 【主入力と音声入力は用途に合うパラメータだけを参照する】
// キーが存在するだけでは不十分であり、接続不可の設定や音声以外への自動割当を防ぐ。
// 正しい参照を指定したときは、実装に渡すパラメータの具体的な型も維持する。
export function checksPrimaryInputRoles() {
	const result = defineNativeEffect({ ...definition, primaryInputParameter: 'input', primaryAudioInputParameter: 'audio' });
	const preserved: true = result.paramDefs.input.canNode;
	const generalParameters: Record<string, ParameterDefinition> = result.paramDefs;
	defineNativeEffect({ ...definition, primaryInputParameter: null, primaryAudioInputParameter: null });
	// @ts-expect-error 接続不可のscalarは主入力にできない
	defineNativeEffect({ ...definition, primaryInputParameter: 'amount' });
	// @ts-expect-error 接続可能な子があってもstruct自体は主入力にできない
	defineNativeEffect({ ...definition, primaryInputParameter: 'group' });
	// @ts-expect-error scalarは主音声入力にできない
	defineNativeEffect({ ...definition, primaryAudioInputParameter: 'input' });
	// @ts-expect-error 未定義のキーからパラメータ一覧を広げない
	defineNativeEffect({ ...definition, primaryAudioInputParameter: 'missing' });
	// @ts-expect-error 主出力の存在確認も維持する
	defineNativeEffect({ ...definition, primaryOutput: 'missing' });
	return { preserved, generalParameters };
}

// 【解像度入力は配列・構造体の末端まで接続可否を調べる】
// コンテナ自体のcanNodeだけで判定すると、有効な入れ子の入力を拒否してしまう。
// 反対に、定数しか保持しない配列を解像度の取得元として指定させない。
export function checksNestedResolutionInputs() {
	defineNativeEffect({ ...definition, resolutionInputParameters: ['input', 'group', 'groups'] });
	defineNativeEffect({ ...definition, resolutionInputParameters: [] });
	// @ts-expect-error 接続不可のscalarからは解像度を取得できない
	defineNativeEffect({ ...definition, resolutionInputParameters: ['amount'] });
	// @ts-expect-error 音声入力は画像の解像度を持たない
	defineNativeEffect({ ...definition, resolutionInputParameters: ['audio'] });
	// @ts-expect-error 配列の要素も接続不可なら解像度入力にできない
	defineNativeEffect({ ...definition, resolutionInputParameters: ['values'] });
	// @ts-expect-error 未定義のキーを解像度入力に指定できない
	defineNativeEffect({ ...definition, resolutionInputParameters: ['missing'] });
}

const imageSetting = { dataType: { kind: 'assetReference', assetType: 'image' }, ui: { label: 'Image' }, defaultValue: null } as const;
const staticSettingDefs = {
	image: imageSetting,
	video: { ...imageSetting, dataType: { kind: 'assetReference', assetType: 'video' } },
	font: { ...imageSetting, dataType: { kind: 'assetReference', assetType: 'font' } },
	lut: { ...imageSetting, dataType: { kind: 'assetReference', assetType: 'lut' } },
	amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount' }, defaultValue: 1 },
} as const;

// 【原寸は画像・動画の静的設定からだけ取得する】
// 素材参照であってもフォントやLUTには描画画像の原寸という意味がない。
// 参照名から設定の型を広げず、宣言された素材の種類を基準に判定する。
export function checksIntrinsicResolutionSources() {
	defineNativeEffect({ ...definition, staticSettingDefs, intrinsicResolutionSetting: 'image' });
	defineNativeEffect({ ...definition, staticSettingDefs, intrinsicResolutionSetting: 'video' });
	// @ts-expect-error フォントは原寸の取得元にできない
	defineNativeEffect({ ...definition, staticSettingDefs, intrinsicResolutionSetting: 'font' });
	// @ts-expect-error LUTは原寸の取得元にできない
	defineNativeEffect({ ...definition, staticSettingDefs, intrinsicResolutionSetting: 'lut' });
	// @ts-expect-error 数値の設定は原寸の取得元にできない
	defineNativeEffect({ ...definition, staticSettingDefs, intrinsicResolutionSetting: 'amount' });
	// @ts-expect-error 未定義の設定を原寸の取得元にできない
	defineNativeEffect({ ...definition, staticSettingDefs, intrinsicResolutionSetting: 'missing' });
}

const enumSetting = { dataType: { kind: 'enum', options: ['first', 'second'] }, ui: { label: 'Mode' }, defaultValue: 'second' } as const;

// 【静的設定の既定値を具体的な選択肢・参照表現に合わせる】
// enumのoptionsが単なるstring配列へ広がると、候補外の既定値を受け入れてしまう。
// 未選択の参照はnullを受け入れ、リテラルの空文字列は型で拒否する。
export function checksStaticSettingDefaults() {
	defineNativeEffect({ ...definition, staticSettingDefs: { mode: enumSetting, image: imageSetting } });
	defineNativeEffect({ ...definition, staticSettingDefs: { image: { ...imageSetting, defaultValue: 'asset-id' } } });
	// @ts-expect-error 静的設定のenumにも選択肢の制約を適用する
	defineNativeEffect({ ...definition, staticSettingDefs: { mode: { ...enumSetting, defaultValue: 'missing' } } });
	// @ts-expect-error 素材の未選択に空文字列を使わない
	defineNativeEffect({ ...definition, staticSettingDefs: { image: { ...imageSetting, defaultValue: '' } } });
	// 通常のstring設定では空文字列も有効な値であり、参照固有の制約を持ち込まない。
	defineNativeEffect({ ...definition, staticSettingDefs: { text: { dataType: { kind: 'string' }, ui: { label: 'Text' }, defaultValue: '' } } });
}

const layoutDefinition = { ...definition, paramDefs: { first: scalar, second: scalar, third: scalar } };

// 【レイアウトの重複・配置漏れを入れ子全体で検出する】
// 型によるキーの存在確認だけでは、同じ編集UIの重複やパラメータの配置忘れを防げない。
// 明示的なas constなしの定義でもタプルを推論し、検査を回避する配列型への拡大を防ぐ。
export function checksLayoutCoverageAndUniqueness() {
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: ['third', { type: 'section', id: 'outer', label: 'Outer', children: [{ type: 'section', id: 'inner', label: 'Inner', children: ['second'] }, 'first'] }] } });
	defineNativeEffect({ ...layoutDefinition });
	defineNativeEffect({ ...definition, paramDefs: {}, ui: { parameterLayout: [] } });
	// @ts-expect-error 別セクションでも同じパラメータを重複配置できない
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: ['first', { type: 'section', id: 'outer', label: 'Outer', children: ['second', 'first'] }, 'third'] } });
	// @ts-expect-error 全パラメータを配置する必要がある
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: ['first', 'second'] } });
	// @ts-expect-error パラメータがある場合に空レイアウトを指定できない
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: [] } });
	// @ts-expect-error 枝が違ってもセクションIDはエフェクト内で一意にする
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: [{ type: 'section', id: 'same', label: 'One', children: ['first'] }, { type: 'section', id: 'outer', label: 'Outer', children: [{ type: 'section', id: 'same', label: 'Two', children: ['second'] }] }, 'third'] } });
	// @ts-expect-error 未定義のパラメータの参照も拒否する
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: ['first', 'second', 'third', 'missing'] } });
	// パラメータ名とセクションIDは別の名前空間なので、同じ文字列を使える。
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: [{ type: 'section', id: 'first', label: 'First', children: ['first', 'second', 'third'] }] } });
}

// 【実行時に組み立てた配列には静的に証明できる条件だけを適用する】
// 長さやIDの具体値が型から失われた配列に対し、重複や網羅性を誤って断定しない。
// 組み込み定義では上のリテラル検査を使いつつ、一般の定義型を扱う呼び出しも維持する。
export function acceptsLayoutsWithUnknownRuntimeContents(layout: readonly EffectParameterLayoutItem<'first' | 'second' | 'third'>[], sectionId: string) {
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: layout } });
	defineNativeEffect({ ...layoutDefinition, ui: { parameterLayout: [{ type: 'section', id: sectionId, label: 'One', children: ['first'] }, { type: 'section', id: sectionId, label: 'Two', children: ['second', 'third'] }] } });
}
