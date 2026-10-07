import { customRef, ref, watch, onScopeDispose } from 'vue';
import { EventEmitter } from 'eventemitter3';
import { deepEqual } from '@gs/shared/utility/deep-equal.js';
import { DEFAULT_PROJECT_BACKUP_SETTINGS } from './project-backups.ts';
import type { Ref } from 'vue';
import type { WorkspaceElement } from './workspace.ts';
import type { MenuItem } from './types/menu.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.js';
import type { TimelineTickMode } from './utility/timeline-ticks.ts';

export const PREF_DEF = definePreferences({
	projectBackups: { default: () => ({ ...DEFAULT_PROJECT_BACKUP_SETTINGS }) },
	animation: { default: () => true },
	menuStyle: { default: () => 'auto' },
	locale: { default: () => 'en' },
	animatedBgInPreview: { default: () => false },
	previewVolume: { default: () => 0.5 },
	forceTypeSafety: { default: () => false },
	showTimecodeInPreview: { default: () => true },
	showGridInPreview: { default: () => false },
	showTransformInPreview: { default: () => true },
	previewTransformSnap: { default: () => true },
	previewTransformKeepRatio: { default: () => true },
	timelineFollowPlayhead: { default: () => false },
	timelineTickMode: { default: (): TimelineTickMode => 'decimal125' },
	timelineHalfTicks: { default: () => true },
	timelineThirdTicks: { default: () => false },
	timelineSnapEnabled: { default: () => true },
	timelineSnapClipStart: { default: () => true },
	timelineSnapClipEnd: { default: () => true },
	timelineSnapToSeekBar: { default: () => true },
	timelineSnapGlobalTicks: { default: () => true },
	timelineSnapLocalTicks: { default: () => false },
	timelineSnapSeekBar: { default: () => false },
	enable32bitDataTextures: { default: () => false },
	intermediateTextureFormat: { default: () => null as IntermediateTextureFormat | null },
	workspaceDefinition: {
		default: (): WorkspaceElement => {
			return {
				id: 'a520c59981e84ae2a04c78a967cbf6f4',
				type: 'tabs',
				direction: 'vertical',
				children: [{
					name: 'Live',
					element: {
						id: '7e07309a8e0743ebaf4ddc9da4c4085f',
						type: 'divider',
						direction: 'horizontal',
						children: [{
							ratio: 0.7,
							element: {
								id: '00bf4e2352824f8193a7b897c1ec028c',
								type: 'divider',
								direction: 'vertical',
								children: [{
									ratio: 0.7,
									element: {
										id: '37aa17431ad448de8ef0164f4cc451aa',
										type: 'divider',
										direction: 'horizontal',
										children: [{
											ratio: 0.3,
											element: {
												id: 'b728279ffbb949c8814f5228f1e98636',
												type: 'divider',
												direction: 'vertical',
												children: [{
													ratio: 0.33,
													element: {
														id: 'adcc26307eda4e7da1d74f34f729eb22',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'histogram',
													},
												}, {
													ratio: 0.33,
													element: {
														id: 'f39599fc1ada4c328688818c01c84ae0',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'waveformHorizontal',
													},
												}, {
													ratio: 0.33,
													element: {
														id: '6f4f6e2dc72d493cb92ebdfab475545c',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'waveformVertical',
													},
												}],
											},
										}, {
											ratio: 0.7,
											element: {
												id: '00750e466cda4f1bb501f4a2c42dc0eb',
												type: 'panel',
												direction: 'horizontal',
												contentType: 'preview',
											},
										}],
									},
								}, {
									ratio: 0.3,
									element: {
										id: 'dac041d318254045b0f55e90f4fb84a0',
										type: 'tabs',
										direction: 'horizontal',
										children: [{
											name: 'Main',
											element: {
												id: '6c618b181173442ab88ec696b51cf936',
												type: 'divider',
												direction: 'horizontal',
												children: [{
													ratio: 0.25,
													element: {
														id: '77688f4068ee4f929f78eb6423c5da24',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'audioSpectrogram',
													},
												}, {
													ratio: 0.25,
													element: {
														id: 'b933bae5a21e43c88b7ca481c71c40c2',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'audioWaveform',
													},
												}, {
													ratio: 0.25,
													element: {
														id: 'e0b66dac15844bc5a27801d4c729dbdf',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'players',
													},
												}, {
													ratio: 0.25,
													element: {
														id: 'b1274afa651a405988e29c508c0c02d5',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'stats',
													},
												}],
											},
										}, {
											name: 'Timeline',
											element: {
												id: '9fa7af18c11e42e78ef277c26aab5fa5',
												type: 'panel',
												direction: 'horizontal',
												contentType: 'timeline',
											},
										}, {
											name: 'Assets',
											element: {
												id: '824a5486145c4ba4911518b2bfc74a7c',
												type: 'panel',
												direction: 'horizontal',
												contentType: 'assets',
											},
										}, {
											name: 'Console',
											element: {
												id: '8d5628e4e3ca4404b4f3cbb905dc35d7',
												type: 'panel',
												direction: 'horizontal',
												contentType: 'blank',
											},
										}, {
											name: 'Logs',
											element: {
												id: 'da1be20a82c84a2f964760fab25c75a3',
												type: 'panel',
												direction: 'horizontal',
												contentType: 'commandLog',
											},
										}, {
											name: 'Project Info',
											element: {
												id: '1a329690fb7b4987a4be5868d0a043ce',
												type: 'panel',
												direction: 'horizontal',
												contentType: 'projectInfo',
											},
										}],
									},
								}],
							},
						}, {
							ratio: 0.3,
							element: {
								id: '2ff9aef841c648b78c94a0c772ca391c',
								type: 'tabs',
								direction: 'horizontal',
								children: [{
									name: 'VM',
									element: {
										id: 'e329ef653d9b4742973426c99c431d68',
										type: 'panel',
										direction: 'horizontal',
										contentType: 'visualModuleEditor',
									},
								}, {
									name: 'TL',
									element: {
										id: '1f8dadc45b114c07a769d9f0a7141c56',
										type: 'panel',
										direction: 'horizontal',
										contentType: 'timelineSubPanel',
									},
								}],
							},
						}],
					},
				}, {
					name: 'Video Editing',
					element: {
						id: 'dded327e2c4f4eb29d5ca29f5acfdc25',
						type: 'divider',
						direction: 'horizontal',
						children: [{
							ratio: 0.7,
							element: {
								id: '9e78d74eef3b4a5f956030d76096d595',
								type: 'divider',
								direction: 'vertical',
								children: [{
									ratio: 0.7,
									element: {
										id: '03cbfd2fe87943dab2dd716d2505c630',
										type: 'divider',
										direction: 'horizontal',
										children: [{
											ratio: 0.3,
											element: {
												id: '8252d957c19647069064078c9bc9d367',
												type: 'tabs',
												direction: 'horizontal',
												children: [{
													name: 'Monitor',
													element: {
														id: '107e36379050499986c630d68b93f137',
														type: 'divider',
														direction: 'vertical',
														children: [{
															ratio: 0.33,
															element: {
																id: '5845486291544b84877198a20cbecb61',
																type: 'panel',
																direction: 'horizontal',
																contentType: 'histogram',
															},
														}, {
															ratio: 0.33,
															element: {
																id: 'db466a3f5f064366abb30d21b52e4682',
																type: 'panel',
																direction: 'horizontal',
																contentType: 'waveformHorizontal',
															},
														}, {
															ratio: 0.33,
															element: {
																id: 'b14cc29ebe304b3f8b7754e20b0fdc17',
																type: 'panel',
																direction: 'horizontal',
																contentType: 'waveformVertical',
															},
														}],
													},
												}, {
													name: 'Asset',
													element: {
														id: 'a73c5f933cd94f1ab8e51caf9ca4542a',
														type: 'panel',
														direction: 'horizontal',
														contentType: 'assets',
													},
												}],
											},
										}, {
											ratio: 0.7,
											element: {
												id: '60841182dc254e2683eaf0718df5a65f',
												type: 'panel',
												direction: 'vertical',
												contentType: 'preview',
											},
										}],
									},
								}, {
									ratio: 0.3,
									element: {
										id: 'f5a1c961595149e4a84f61ccf8908977',
										type: 'panel',
										direction: 'vertical',
										contentType: 'timeline',
									},
								}],
							},
						}, {
							ratio: 0.3,
							element: {
								id: 'f4901ad62b6a49a5b95fc57ed851190e',
								type: 'panel',
								direction: 'horizontal',
								contentType: 'timelineSubPanel',
							},
						}],
					},
				}],
			} satisfies WorkspaceElement;
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
			text: 'Reset to default value',
			danger: true,
			action: () => {
				this.commit(key, PREF_DEF[key].default());
			},
		}];
	}
}

export const preferences = new PreferencesManager();
