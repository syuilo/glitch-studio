import { ref } from 'vue';
import type { Ref, MaybeRefOrGetter } from 'vue';
import type { GsSelectItem, GetGsSelectValueTypesFromDef } from '@/components/common/GsSelect.vue';
import type { OptionValue } from '@/types/option-value.ts';

type UnwrapReadonlyItems<T> = T extends readonly (infer U)[] ? U[] : T;

/** 指定したオプション定義をもとに型を狭めたrefを生成するコンポーサブル */
export function useGsSelect<
	const TItemsInput extends MaybeRefOrGetter<GsSelectItem[]>,
	const TItems extends TItemsInput extends MaybeRefOrGetter<infer U> ? U : never,
	TInitialValue extends OptionValue | void = void,
	TItemsValue = GetGsSelectValueTypesFromDef<UnwrapReadonlyItems<TItems>>,
	ModelType = TInitialValue extends void
		? TItemsValue
		: (TItemsValue | TInitialValue)
>(opts: {
	items: TItemsInput;
	initialValue?: (TInitialValue | (OptionValue extends TItemsValue ? OptionValue : TInitialValue)) & (
		TItemsValue extends TInitialValue
			? unknown
			: { 'Error: Type of initialValue must include all types of items': TItemsValue }
	);
}): {
	def: TItemsInput;
	model: Ref<ModelType>;
} {
	const model = ref(opts.initialValue ?? null);

	return {
		def: opts.items,
		model: model as Ref<ModelType>,
	};
}
