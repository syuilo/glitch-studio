import type { EffectParameterDefinition } from '../src/effect-definition.ts';

// 【配列内の構造体も、要素の追加用設定も、末端までliteralのみを許可する】
// 配置のBindingと型を共有すると、既定値から入力種別を静的に決められなくなる。
type NestedParameter = EffectParameterDefinition<{ kind: 'array'; elementType: { kind: 'struct'; fields: { gain: { kind: 'scalar' } } } }>;
type ArrayField = NestedParameter['defaultValue']['value'][number]['binding']['value']['gain'];
type NewElementField = NestedParameter['element']['defaultValue']['value']['gain'];
type FieldDefault = NestedParameter['element']['fields']['gain']['defaultValue'];
const literal: ArrayField = { inputSource: 'literal', value: 2 };
const expression = { inputSource: 'expression', expression: 'TIME' } as const;
// @ts-expect-error 配列全体の既定値に埋め込んだフィールド
const arrayField: ArrayField = expression;
// @ts-expect-error 要素追加時の構造体に埋め込んだフィールド
const elementField: NewElementField = expression;
// @ts-expect-error フィールド自体の既定値
const fieldDefault: FieldDefault = expression;
