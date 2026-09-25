import { computed } from 'vue';
import type { Ref } from 'vue';
import type { NodeOutputReference } from '@glitch/shared/visual-module/types.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';

// NOTE: 実装の簡略化のため、このメニューの表示中にconnectionRefの内容がUndoなどで変化した場合はエッジケースとして扱い対応はしません。
// (メニューを開いている間にそのような操作をすることはあまり無いと考えられます。そもそもメニュー表示中は、メニュー項目の選択以外の操作が制限されます)

export function getNodeInputSamplingMenuItems(connectionRef: Ref<NodeOutputReference>, update: (connection: NodeOutputReference) => void): MenuItem[] {
	return [{
		type: 'radio',
		text: 'Fit Mode',
		caption: computed(() => i18n.t(`_FitModes.${connectionRef.value.fitMode}`)),
		ref: computed({
			get: () => connectionRef.value.fitMode,
			set: (fitMode: NodeOutputReference['fitMode']) => {
				update({ ...connectionRef.value, fitMode });
			},
		}),
		options: [{ label: i18n.t('_FitModes.stretch'), value: 'stretch' }, { label: i18n.t('_FitModes.cover'), value: 'cover' }, { label: i18n.t('_FitModes.contain'), value: 'contain' }],
	}, {
		type: 'radio',
		text: 'Wrap Mode',
		caption: computed(() => i18n.t(`_WrapModes.${connectionRef.value.wrapMode}`)),
		ref: computed({
			get: () => connectionRef.value.wrapMode,
			set: (wrapMode: NodeOutputReference['wrapMode']) => {
				update({ ...connectionRef.value, wrapMode });
			},
		}),
		options: [{ label: i18n.t('_WrapModes.clamp'), value: 'clamp' }, { label: i18n.t('_WrapModes.repeat'), value: 'repeat' }, { label: i18n.t('_WrapModes.repeatMirrored'), value: 'repeatMirrored' }, { label: i18n.t('_WrapModes.transparent'), value: 'transparent' }],
	}, {
		type: 'radio',
		text: 'Filter Mode',
		caption: computed(() => i18n.t(`_FilterModes.${connectionRef.value.filterMode}`)),
		ref: computed({
			get: () => connectionRef.value.filterMode,
			set: (filterMode: NodeOutputReference['filterMode']) => {
				update({ ...connectionRef.value, filterMode });
			},
		}),
		options: [{ label: i18n.t('_FilterModes.linear'), value: 'linear' }, { label: i18n.t('_FilterModes.nearest'), value: 'nearest' }],
	}];
}
