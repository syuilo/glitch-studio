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

export function validateEffectParameterLayout(effectId: string, parameterKeys: readonly string[], layout: readonly EffectParameterLayoutItem[]): void {
	const remainingParameterKeys = new Set(parameterKeys);
	const placedParameterKeys = new Set<string>();
	const sectionIds = new Set<string>();

	function visit(items: readonly EffectParameterLayoutItem[]): void {
		for (const item of items) {
			if (typeof item === 'string') {
				if (placedParameterKeys.has(item)) throw new Error(`Duplicate parameter in layout: ${effectId}.${item}`);
				if (!remainingParameterKeys.delete(item)) throw new Error(`Unknown parameter in layout: ${effectId}.${item}`);
				placedParameterKeys.add(item);
			} else {
				if (sectionIds.has(item.id)) throw new Error(`Duplicate parameter section ID: ${effectId}.${item.id}`);
				sectionIds.add(item.id);
				visit(item.children);
			}
		}
	}

	visit(layout);
	// 追加したパラメータを配置し忘れても、UIから黙って消えないよう定義時に検出する。
	if (remainingParameterKeys.size > 0) throw new Error(`Missing parameters in layout for ${effectId}: ${[...remainingParameterKeys].join(', ')}`);
}
