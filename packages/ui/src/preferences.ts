import { customRef, ref, watch, onScopeDispose } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { deepEqual } from '@glitch/shared/utility/deep-equal.js';
import type { Ref } from 'vue';
import type { WorkspaceDivider } from './types/workspace.ts';
import type { MenuItem } from './types/menu.ts';

export const PREF_DEF = definePreferences({
	animation: { default: () => true },
	menuStyle: { default: () => 'auto' },
	locale: { default: () => 'en' },
	animatedBgInPreview: { default: () => false },
	workspaceDefinition: {
		default: () => {
			return {
				id: 'root',
				ratio: 1,
				type: null,
				direction: 'horizontal',
				children: [{
					id: 'c138f76ec1d84ba5b83b0cc3766a1266',
					ratio: 0.7,
					type: null,
					direction: 'vertical',
					children: [{
						id: '938e3eedc00d4287885b6894ee3ea8c3',
						ratio: 0.6,
						type: null,
						direction: 'horizontal',
						children: [{
							id: '53ef52d7a5a44b41ba34a0491b4f5d8e',
							ratio: 0.25,
							type: null,
							direction: 'vertical',
							children: [{
								id: '0f34c5f4c9cb449683c7f1281851b759',
								ratio: 0.33,
								type: 'histogram',
							}, {
								id: 'b3d6059aaa554ae79441286cd2beb685',
								ratio: 0.33,
								type: 'audioWaveform',
							}, {
								id: '47edf72197d94d28b6b2811bfecc97e5',
								ratio: 0.33,
								type: 'stats',
							}],
						}, {
							id: '5ec0a586d9654755acdaa2ae6837f28e',
							ratio: 0.75,
							type: 'preview',
						}],
					}, {
						id: '8aec4dd7bf82460eba420680fda4f652',
						ratio: 0.4,
						type: null,
						direction: 'vertical',
						children: [{
							id: 'ba8f8efaa9a54a109340b2f3e329cda2',
							ratio: 0.5,
							type: null,
							direction: 'horizontal',
							children: [{
								id: '251858d938b0448aafd613b73c7e352c',
								ratio: 0.25,
								type: 'audioSpectrogram',
							}, {
								id: '136c0ccc916c438787756c07da414be7',
								ratio: 0.25,
								type: 'waveformHorizontal',
							}, {
								id: 'ca5eba2936d4423891377972de6a41f5',
								ratio: 0.25,
								type: 'waveformVertical',
							}, {
								id: '15bd089777d440a0baaf2953c8020e24',
								ratio: 0.25,
								type: 'players',
							}],
						}, {
							id: '2d9d8a38ce9a4d24bc70a500f892f124',
							ratio: 0.5,
							type: 'timeline',
						}],
					}],
				}, {
					id: '441518aeb37940b2af7fb0027fd530a9',
					ratio: 0.3,
					type: 'nodesEditor',
				}],
			} as WorkspaceDivider;
		},
	},
});

type PREF = typeof PREF_DEF;
type DefaultValues = {
	[K in keyof PREF]: PREF[K]['default'] extends (...args: any) => infer R ? R : PREF[K]['default'];
};
type ValueOf<K extends keyof PREF> = DefaultValues[K];

type PreferencesDefinitionRecord<Default> = {
	default: () => Default;
};

export type PreferencesDefinition = Record<string, PreferencesDefinitionRecord<any>>;

type PreferencesManagerEvents = {
	'committed': <K extends keyof PREF>(ctx: {
		key: K;
		value: ValueOf<K>;
		oldValue: ValueOf<K>;
	}) => void;
};

export function definePreferences<T extends Record<string, unknown>>(x: {
	[K in keyof T]: PreferencesDefinitionRecord<T[K]>
}): {
	[K in keyof T]: PreferencesDefinitionRecord<T[K]>
} {
	return x;
}

export class PreferencesManager extends EventEmitter<PreferencesManagerEvents> {
	/**
	 * static / state の略 (static が予約語のため)
	 */
	public s = {} as {
		[K in keyof PREF]: ValueOf<K>;
	};

	/**
	 * reactive の略
	 */
	public r = {} as {
		[K in keyof PREF]: Ref<ValueOf<K>>;
	};

	constructor() {
		super();

		const savedStatesRaw = window.localStorage.getItem('preferences');
		const savedStates = savedStatesRaw ? JSON.parse(savedStatesRaw) : {};

		const states = {
			...this.genStates(),
			...savedStates,
		};

		// apply states
		for (const key in states) {
			(this.s[key as keyof PREF] as any) = states[key as keyof PREF];
			(this.r[key as keyof PREF] as Ref<any>) = ref(this.s[key as keyof PREF]);
		}
	}

	private rewriteRawState<K extends keyof PREF>(key: K, value: ValueOf<K>) {
		const v = JSON.parse(JSON.stringify(value)); // deep copy 兼 vueのプロキシ解除
		this.r[key].value = this.s[key] = v;
	}

	public commit<K extends keyof PREF>(key: K, value: ValueOf<K>) {
		const v = JSON.parse(JSON.stringify(value)); // deep copy 兼 vueのプロキシ解除

		if (deepEqual(this.s[key], v)) {
			return;
		}

		this.rewriteRawState(key, v);

		const _save = () => {
			this.save();
			this.emit('committed', {
				key,
				value: v,
				oldValue: this.s[key],
			});
		};

		_save();
	}

	/**
	 * 特定のキーの、簡易的なcomputed refを作ります
	 * 主にvue上で設定コントロールのmodelとして使う用
	 */
	public model<K extends keyof PREF, V = ValueOf<K>>(
		key: K,
	): Ref<V>;
	public model<K extends keyof PREF, V extends Exclude<any, ValueOf<K>>>(
		key: K,
		getter: (v: ValueOf<K>) => V,
		setter: (v: V) => ValueOf<K>,
	): Ref<V>;

	public model<K extends keyof PREF, V>(
		key: K,
		getter?: (v: ValueOf<K>) => V,
		setter?: (v: V) => ValueOf<K>,
	): Ref<V> {
		return customRef<V>((track, trigger) => {
			const watchStop = watch(this.r[key], () => {
				trigger();
			});

			onScopeDispose(() => {
				watchStop();
			}, true);

			return {
				get: () => {
					track();
					return (getter != null ? getter(this.s[key]) : this.s[key]) as V;
				},
				set: (value) => {
					const val = setter != null ? setter(value) : value;
					this.commit(key, val as ValueOf<K>);
				},
			};
		});
	}

	private genStates() {
		const states = {} as { [K in keyof PREF]: ValueOf<K> };
		for (const _key in PREF_DEF) {
			const key = _key as keyof PREF;
			(states[key] as any) = PREF_DEF[key].default();
		}

		return states;
	}

	public save() {
		// TODO: Throttle
		window.localStorage.setItem('preferences', JSON.stringify(this.s));
	}

	public getPerPrefMenu<K extends keyof PREF>(key: K): MenuItem[] {
		return [{
			icon: 'ti ti-refresh',
			text: i18n.ts.resetToDefaultValue,
			danger: true,
			action: () => {
				this.commit(key, PREF_DEF[key].default());
			},
		}];
	}
}

export const preferences = new PreferencesManager();
