import { nextTick, ref, defineAsyncComponent } from 'vue';
import getCaretCoordinates from 'textarea-caret';
import type { Ref } from 'vue';
import type { CompleteInfo } from '@/components/common/GsAutocomplete.vue';
import { popup } from '@/ui.ts';

export type SuggestionType = keyof CompleteInfo;

type CompleteProps<T extends keyof CompleteInfo> = {
	type: T;
	value: CompleteInfo[T]['payload'];
};

export class Autocomplete {
	private suggestion: {
		x: Ref<number>;
		y: Ref<number>;
		q: Ref<string>;
		close: () => void;
	} | null;
	private textarea: HTMLInputElement | HTMLTextAreaElement;
	private currentType: keyof CompleteInfo | undefined;
	private textRef: Ref<string | number | null>;
	private opening: boolean;
	private onlyType: SuggestionType[];

	private get text(): string {
		// Use raw .value to get the latest value
		// (Because v-model does not update while composition)
		return this.textarea.value;
	}

	private set text(text: string) {
		// Use ref value to notify other watchers
		// (Because .value setter never fires input/change events)
		this.textRef.value = text;
	}

	/**
	 * 対象のテキストエリアを与えてインスタンスを初期化します。
	 */
	constructor(textarea: HTMLInputElement | HTMLTextAreaElement, textRef: Ref<string | number | null>, onlyType?: SuggestionType[]) {
		//#region BIND
		this.onInput = this.onInput.bind(this);
		this.complete = this.complete.bind(this);
		this.close = this.close.bind(this);
		//#endregion

		this.suggestion = null;
		this.textarea = textarea;
		this.textRef = textRef;
		this.opening = false;
		this.onlyType = onlyType ?? ['variable'];

		this.attach();
	}

	/**
	 * このインスタンスにあるテキストエリアの入力のキャプチャを開始します。
	 */
	public attach() {
		this.textarea.addEventListener('input', this.onInput);
	}

	/**
	 * このインスタンスにあるテキストエリアの入力のキャプチャを解除します。
	 */
	public detach() {
		this.textarea.removeEventListener('input', this.onInput);
		this.close();
	}

	/**
	 * テキスト入力時
	 */
	private onInput() {
		const before = this.text.substring(0, this.textarea.selectionStart ?? 0);
		const query = before.match(/[a-zA-Z_][a-zA-Z0-9_]*$/)?.[0];
		if (query && this.onlyType.includes('variable')) {
			this.open('variable', query);
		} else {
			this.close();
		}
	}

	/**
	 * サジェストを提示します。
	 */
	private open(type: 'variable', q: string) {
		if (type !== this.currentType) {
			this.close();
		}
		if (this.opening) return;
		this.opening = true;
		this.currentType = type;

		//#region サジェストを表示すべき位置を計算
		const caretPosition = getCaretCoordinates(this.textarea, this.textarea.selectionStart ?? 0);

		const rect = this.textarea.getBoundingClientRect();

		const x = rect.left + caretPosition.left - this.textarea.scrollLeft;
		const y = rect.top + caretPosition.top - this.textarea.scrollTop;
		//#endregion

		if (this.suggestion) {
			this.suggestion.x.value = x;
			this.suggestion.y.value = y;
			this.suggestion.q.value = q;

			this.opening = false;
		} else {
			const _x = ref(x);
			const _y = ref(y);
			const _q = ref(q);

			const { dispose } = popup(defineAsyncComponent(() => import('@/components/common/GsAutocomplete.vue')), {
				textarea: this.textarea,
				close: this.close,
				type: type,
				q: _q,
				x: _x,
				y: _y,
			}, {
				done: (res) => {
					this.complete(res);
				},
			});

			this.suggestion = {
				q: _q,
				x: _x,
				y: _y,
				close: () => dispose(),
			};

			this.opening = false;
		}
	}

	/**
	 * サジェストを閉じます。
	 */
	private close() {
		if (this.suggestion == null) return;

		this.suggestion.close();
		this.suggestion = null;

		this.textarea.focus();
	}

	/**
	 * オートコンプリートする
	 */
	private complete(props: CompleteProps<'variable'>) {
		this.close();
		const caret = this.textarea.selectionStart ?? 0;
		const before = this.text.substring(0, caret);
		const prefix = before.replace(/[a-zA-Z_][a-zA-Z0-9_]*$/, '');
		this.text = prefix + props.value + this.text.substring(caret);
		nextTick(() => {
			this.textarea.focus();
			const pos = prefix.length + props.value.length;
			this.textarea.setSelectionRange(pos, pos);
		});
	}
}
