import { resolveParameter, walkParameters } from '../src/parameter/parameter-path.ts';
import { mapParameterTree, walkParameterLeaves } from '../src/parameter/parameter-tree.ts';
import { ParameterBindingEvaluator } from '../src/parameter/parameter-binding-evaluator.ts';
import type { ParameterDefaultValue, ParameterDefinition } from '../src/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '../src/parameter/value-parameter-binding.ts';

// 【加工設定は利用箇所のBindingにだけ保持する】
// 広いBinding型を経由した代入でも、既定値とコンテナの子へ加工式を持ち込ませない。
declare const modifiedLiteral: Extract<ValueParameterBinding, { inputSource: 'literal' }>;
declare const modifiedExpression: Extract<ValueParameterBinding, { inputSource: 'expression' }>;
// @ts-expect-error 通常のBindingは加工設定を持ち得るため既定値として代入しない
const scalarDefault: ParameterDefaultValue<{ kind: 'scalar' }> = modifiedLiteral;
const arrayDefault: ParameterDefaultValue<{ kind: 'array'; elementType: { kind: 'scalar' } }> = {
	inputSource: 'literal',
	// @ts-expect-error 子が非literalでも既定値では加工設定を禁止する
	value: [{ id: 'first', binding: modifiedExpression }],
};

// 【評価には必ずパラメータの型を渡す】
// 定義を渡し忘れた呼び出しで、基準値や式の結果の型検証が省略されないようにする。
// @ts-expect-error 第4引数のパラメータ定義は必須
new ParameterBindingEvaluator().evaluate(modifiedLiteral, { variables: {}, automationGraphs: [], time: 0, endTime: 0 }, null);

// sharedのテストは実際の利用ドメインに依存せず、独自方式を加えた利用側を模擬する。
type ReferenceBinding = { inputSource: 'testReference'; referenceId: string };
type DomainBinding = ValueParameterBinding | ReferenceBinding;

declare const arrayDefinition: ParameterDefinition<{ kind: 'array'; elementType: { kind: 'scalar' } }>;
declare const structDefinition: ParameterDefinition<{ kind: 'struct'; fields: { amount: { kind: 'scalar' } } }>;
const definitions = { array: arrayDefinition, struct: structDefinition };
const literalParents = { array: arrayDefinition.defaultValue, struct: structDefinition.defaultValue };

// 親はliteralと分かっていても、配列要素・構造体フィールドには式などが入る。
// 型引数の指定漏れを親の具体型やコールバックの型から補ってはいけない。
// @ts-expect-error ツリー全体で許可するBinding型を明示する必要がある
mapParameterTree(arrayDefinition, arrayDefinition.defaultValue, [], () => 0);
// @ts-expect-error コールバックからもBinding型を推論しない
mapParameterTree(structDefinition, structDefinition.defaultValue, [], (_def, _binding: DomainBinding) => 0);
// @ts-expect-error 親だけがliteralの一覧から子のBinding型を推論しない
walkParameterLeaves(definitions, literalParents);
// @ts-expect-error IDパスの解決でも子のBinding型を親から推論しない
resolveParameter(definitions, literalParents, ['array', 'first']);
// @ts-expect-error 既定値を補完する走査でもドメインのBinding型を明示する
walkParameters(definitions, literalParents);

// 共通方式だけのツリーでも、literalの初期値から式の末端を取り出せる。
mapParameterTree<ValueParameterBinding>(arrayDefinition, arrayDefinition.defaultValue, [], (_def, binding) => {
	// @ts-expect-error literalの親でも末端のvalueを無条件に読むことはできない
	binding.value;
	if (binding.inputSource === 'expression') return binding.expression;
	return binding.inputSource;
});
for (const { param } of walkParameterLeaves<ValueParameterBinding>(definitions, literalParents)) {
	// @ts-expect-error structの親の型も末端には適用しない
	param.value;
	if (param.inputSource === 'expression') {
		const expression: string = param.expression;
	}
}

// ドメインを明示すると、literalの親の下でも固有方式を読める。
mapParameterTree<DomainBinding>(structDefinition, structDefinition.defaultValue, [], (_def, binding) => {
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
resolved.value.value;
const common = resolveParameter<ValueParameterBinding>(definitions, literalParents, ['array', 'first']);
// @ts-expect-error 共通方式だけのツリーには固有方式を書き込めない
common.setValue({ inputSource: 'testReference', referenceId: 'source' });

// 保存値が未設定なら、指定した方式に加えて定義側の共通方式も走査される。
for (const { value } of walkParameters<ReferenceBinding>(definitions, {})) {
	if (value.inputSource === 'expression') {
		const expression: string = value.expression;
	}
}
