import { resolveParameter, walkParameters } from '../src/parameter/parameter-path.ts';
import { mapParameterTree, walkParameterLeaves } from '../src/parameter/parameter-tree.ts';
import { ParameterBindingEvaluator } from '../src/parameter/parameter-binding-evaluator.ts';
import { createDefaultParameterBinding } from '../src/parameter/parameter-default.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '../src/parameter/parameter-definition.ts';
import type { ParameterDefaultValue, ParameterDefinition } from '../src/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '../src/parameter/value-parameter-binding.ts';

// 【定義の既定値には値を直接指定する】
// 入力方式や加工式を持つBindingは、利用箇所の編集状態として扱う。
declare const modifiedLiteral: Extract<ValueParameterBinding, { inputSource: 'literal' }>;
// @ts-expect-error scalarの既定値は数値
const scalarDefault: ParameterDefaultValue<{ kind: 'scalar' }> = modifiedLiteral;

// 【配列内の構造体も、要素の追加用設定も、末端までliteralのみを許可する】
// 既定値を利用箇所から独立させ、参照解決や式評価をせずに初期状態を作れるようにする。
type NestedParameter = ParameterDefinition<{ kind: 'array'; elementType: { kind: 'struct'; fields: { amount: { kind: 'scalar' } } } }>;
type ArrayField = NestedParameter['defaultValue'][number]['amount'];
type NewElementField = NestedParameter['element']['defaultValue']['amount'];
type FieldDefault = NestedParameter['element']['fields']['amount']['defaultValue'];
const literal: ArrayField = 2;
const expression = { inputSource: 'expression', expression: 'TIME' } as const;
// @ts-expect-error 配列全体の既定値に埋め込んだフィールドにも式は指定できない
const arrayField: ArrayField = expression;
// @ts-expect-error 要素追加時の構造体に埋め込んだフィールドにも式は指定できない
const elementField: NewElementField = expression;
// @ts-expect-error フィールド自体の既定値にも式は指定できない
const fieldDefault: FieldDefault = expression;

// 【評価には必ずパラメータの型を渡す】
// 定義を渡し忘れた呼び出しで、基準値や式の結果の型検証が省略されないようにする。
// @ts-expect-error 第4引数のパラメータ定義は必須
new ParameterBindingEvaluator(null).evaluate(modifiedLiteral, { variables: {}, automationGraphs: [], time: 0, endTime: 0 }, null);

// sharedのテストは実際の利用ドメインに依存せず、独自方式を加えた利用側を模擬する。
type ReferenceBinding = { inputSource: 'testReference'; referenceId: string };
type DomainBinding = ValueParameterBinding | ReferenceBinding;

declare const arrayDefinition: ParameterDefinition<{ kind: 'array'; elementType: { kind: 'scalar' } }>;
declare const structDefinition: ParameterDefinition<{ kind: 'struct'; fields: { amount: { kind: 'scalar' } } }>;

// 【配列要素・構造体フィールドの取得には、種類を絞り込んだ定義だけを許可する】
// 取得関数内で再検証せず、誤った種類や未分岐の定義を渡す実装をコンパイル時に拒否する。
getArrayElementDefinition(arrayDefinition);
getStructFieldDefinitions(structDefinition);
// @ts-expect-error 配列要素は構造体から取得できない
getArrayElementDefinition(structDefinition);
// @ts-expect-error 構造体フィールドは配列から取得できない
getStructFieldDefinitions(arrayDefinition);
declare const unknownDefinition: ParameterDefinition;
// @ts-expect-error 種類を絞り込んでいない定義は渡せない
getArrayElementDefinition(unknownDefinition);
// @ts-expect-error 構造体も呼び出し側で種類を絞り込む
getStructFieldDefinitions(unknownDefinition);

const definitions = { array: arrayDefinition, struct: structDefinition };
const literalParents = { array: createDefaultParameterBinding(arrayDefinition), struct: createDefaultParameterBinding(structDefinition) };

// 親はliteralと分かっていても、配列要素・構造体フィールドには式などが入る。
// 型引数の指定漏れを親の具体型やコールバックの型から補ってはいけない。
// @ts-expect-error ツリー全体で許可するBinding型を明示する必要がある
mapParameterTree(arrayDefinition, literalParents.array, [], () => 0);
// @ts-expect-error コールバックからもBinding型を推論しない
mapParameterTree(structDefinition, literalParents.struct, [], (_def, _binding: DomainBinding) => 0);
// @ts-expect-error 親だけがliteralの一覧から子のBinding型を推論しない
walkParameterLeaves(definitions, literalParents);
// @ts-expect-error IDパスの解決でも子のBinding型を親から推論しない
resolveParameter(definitions, literalParents, ['array', 'first']);
// @ts-expect-error IDパスを使う走査でもドメインのBinding型を明示する
walkParameters(definitions, literalParents);

// 共通方式だけのBindingを持つ配置では、literalの親の下にも式を指定できる。
mapParameterTree<ValueParameterBinding>(arrayDefinition, literalParents.array, [], (_def, binding) => {
	// @ts-expect-error literalの親でも末端のvalueを無条件に読むことはできない
	void binding.value;
	if (binding.inputSource === 'expression') return binding.expression;
	return binding.inputSource;
});
for (const { param } of walkParameterLeaves<ValueParameterBinding>(definitions, literalParents)) {
	// @ts-expect-error structの親の型も末端には適用しない
	void param.value;
	if (param.inputSource === 'expression') {
		const expression: string = param.expression;
	}
}

// ドメインを明示すると、literalの親の下でも固有方式を読める。
mapParameterTree<DomainBinding>(structDefinition, literalParents.struct, [], (_def, binding) => {
	if (binding.inputSource === 'testReference') return binding.referenceId;
	return binding.inputSource;
});
for (const { param } of walkParameterLeaves<DomainBinding>(definitions, literalParents)) {
	const binding: DomainBinding = param;
	if (param.inputSource === 'testReference') {
		const referenceId: string = param.referenceId;
	}
}
for (const { value } of walkParameters<DomainBinding>(definitions, literalParents)) {
	const binding: DomainBinding = value;
	if (value.inputSource === 'testReference') {
		const referenceId: string = value.referenceId;
	}
}

// 走査後に絞り込んだ型は、UI表示用のオブジェクトに格納しても維持する。
// 推論を止めるためのNoInferを戻り値へ持ち込むと、この絞り込みが失われる。
const expressions = [...walkParameters<DomainBinding>(definitions, literalParents)]
	.flatMap(({ value }) => value.inputSource === 'expression' ? [{ binding: value }] : []);
for (const { binding } of expressions) {
	const expression: string = binding.expression;
}

// 書き込み先も同じドメインに固定し、式・固有方式への切替を許可する。
const resolved = resolveParameter<DomainBinding>(definitions, literalParents, ['struct', 'amount']);
resolved.setValue({ inputSource: 'expression', expression: 'TIME' });
resolved.setValue({ inputSource: 'testReference', referenceId: 'source' });
// @ts-expect-error 許可していない別ドメインの方式は書き込めない
resolved.setValue({ inputSource: 'foreignReference', referenceId: 'source' });
// @ts-expect-error 戻り値も親のliteralではなく、ドメイン全体のBindingとなる
void resolved.value.value;
const common = resolveParameter<ValueParameterBinding>(definitions, literalParents, ['array', 'first']);
// @ts-expect-error 共通方式だけのツリーには固有方式を書き込めない
common.setValue({ inputSource: 'testReference', referenceId: 'source' });

// 走査結果は利用ドメインのBinding型に一致する。
for (const { value } of walkParameters<ReferenceBinding>(definitions, {})) {
	const binding: ReferenceBinding = value;
}
