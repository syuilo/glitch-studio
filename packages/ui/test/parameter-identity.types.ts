import { parameterId, parameterName, type ParameterId, type ParameterName } from '@glitch/shared/parameter-identity.ts';
import type { ParameterBinding, VisualModuleParameterBindings } from '@glitch/shared/types.ts';
import type { VisualModuleParamDef } from '@glitch/shared/effect-definition.ts';
import type { EvaluatedParameterValues, ParameterEvaluationContext } from '../../renderer/src/parameter-evaluator.ts';
import type { VisualModuleRenderContext } from '../../renderer/src/visual-module-renderer.ts';

// IDと名前の取り違えを拒否する。vue-tscで検査し、この関数自体は実行しない。
export function rejectsMixedParameterIdentities(
	values: EvaluatedParameterValues,
	rawValues: VisualModuleParameterBindings,
	idsByName: NonNullable<ParameterEvaluationContext['paramIdsByName']>,
	inputs: NonNullable<VisualModuleRenderContext['paramInputs']>,
	def: VisualModuleParamDef,
) {
	const id: ParameterId = parameterId('gain-id');
	const name: ParameterName = parameterName('Gain');
	values.get(id);
	values.get(def.id);
	idsByName.get(name);
	idsByName.get(def.name);
	inputs.get(id);
	rawValues[id] = { inputSource: 'literal', value: 2 };
	const reference: ParameterBinding = { inputSource: 'externalParameterInput', parameterId: id };

	// @ts-expect-error 名前で評価済み値を検索してはいけない。
	values.get(name);
	// @ts-expect-error 通常のstringもIDではない。
	values.get('gain-id');
	// @ts-expect-error 名前解決MapにIDを渡してはいけない。
	idsByName.get(id);
	// @ts-expect-error 入力もIDで参照する。
	inputs.get(name);
	// @ts-expect-error 保存値のキーもIDに統一する。
	rawValues[name] = { inputSource: 'literal', value: 2 };
	// @ts-expect-error 外部入力参照は名前を保存しない。
	const invalidReference: ParameterBinding = { inputSource: 'externalParameterInput', parameterId: name };
	// @ts-expect-error パラメータ定義のIDには名前を代入できない。
	def.id = name;
	// @ts-expect-error パラメータ定義の名前にはIDを代入できない。
	def.name = id;
	// @ts-expect-error 変換関数でも分類済みの名前をIDに変換させない。
	parameterId(name);
	// @ts-expect-error 変換関数でも分類済みのIDを名前に変換させない。
	parameterName(id);
	return { reference, invalidReference };
}
