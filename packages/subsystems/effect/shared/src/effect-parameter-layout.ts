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

/** 編集可能な定義は読み込み時にも、Native Effectのリテラルと同じ網羅性・一意性を確認する。 */
export function validateEffectParameterLayout(layout: readonly EffectParameterLayoutItem[], parameterIds: readonly string[]): void {
	const remaining = new Set(parameterIds);
	const sections = new Set<string>();

	function visit(items: readonly EffectParameterLayoutItem[]) {
		for (const item of items) {
			if (typeof item === 'string') {
				if (!remaining.delete(item)) throw new Error('Unknown or duplicate layout parameter: ' + item);
			} else {
				if (item.id.length === 0 || sections.has(item.id)) throw new Error('Invalid layout section: ' + item.id);
				sections.add(item.id);
				visit(item.children);
			}
		}
	}

	visit(layout);
	if (remaining.size > 0) throw new Error('Missing layout parameters: ' + [...remaining].join(', '));
}

// 入れ子を表示順のタプルに展開し、別のセクションにある同じパラメータやIDも照合する。
// 長さの分からない配列では重複・網羅性を証明できないため、通常の配列型として扱う。
type FlattenEffectParameterLayout<Layout extends readonly EffectParameterLayoutItem[]> =
	number extends Layout['length'] ? EffectParameterLayoutItem[] :
		Layout extends readonly [infer First extends EffectParameterLayoutItem, ...infer Rest extends readonly EffectParameterLayoutItem[]]
			? First extends string
				? [First, ...FlattenEffectParameterLayout<Rest>]
				: First extends EffectParameterSection
					? [First, ...FlattenEffectParameterLayout<First['children']>, ...FlattenEffectParameterLayout<Rest>]
					: never
			: [];

type HasUniqueEffectParameterLayoutEntries<Entries extends readonly EffectParameterLayoutItem[], ParameterKeys extends string = never, SectionIds extends string = never> =
	Entries extends readonly [infer First extends EffectParameterLayoutItem, ...infer Rest extends readonly EffectParameterLayoutItem[]]
		? First extends string
			? First extends ParameterKeys ? false : HasUniqueEffectParameterLayoutEntries<Rest, ParameterKeys | First, SectionIds>
			// 変数から渡された一般のstringは同じ値とは限らないので、ID重複の判定に使わない。
			: First extends EffectParameterSection
				? string extends First['id'] ? HasUniqueEffectParameterLayoutEntries<Rest, ParameterKeys, SectionIds>
					: First['id'] extends SectionIds ? false : HasUniqueEffectParameterLayoutEntries<Rest, ParameterKeys, SectionIds | First['id']>
				: never
		: true;

export type CheckedEffectParameterLayout<Layout extends readonly EffectParameterLayoutItem[], ParameterKey extends string> =
	FlattenEffectParameterLayout<Layout> extends infer Entries extends readonly EffectParameterLayoutItem[]
		? number extends Entries['length'] ? Layout
			: Exclude<ParameterKey, Extract<Entries[number], string>> extends never
				? HasUniqueEffectParameterLayoutEntries<Entries> extends true ? Layout : never
				: never
		: never;
