// セクションは表示上の分類であり、パラメータの型・Binding・参照パスには含めない。
// トップレベルのパラメータを参照し、structやarrayは既存の編集UIごと配置する。
export type EffectParameterLayoutItem<ParameterKey extends string = string> = ParameterKey | EffectParameterSection<ParameterKey>;

export type EffectParameterSection<ParameterKey extends string = string> = {
	type: 'section';
	// 表示名や親セクションを変更しても開閉状態を識別できるよう、エフェクト内で一意にする。
	id: string;
	label: string;
	defaultExpanded?: boolean;
	children: readonly EffectParameterLayoutItem<ParameterKey>[];
};
