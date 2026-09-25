import { computed } from 'vue';
import type { NodeOutputReference } from '@glitch/shared/types.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';

/** メニュー表示中のUndoや接続変更にも追従し、変更時には最新の接続情報を保持する。 */
export function getNodeInputSamplingMenuItems(read: () => NodeOutputReference | null, update: (connection: NodeOutputReference) => void): MenuItem[] {
	const disabled = computed(() => read() == null);
	return [{
		type: 'radio',
		text: 'Fit Mode',
		disabled,
		caption: computed(() => i18n.t(`_FitModes.${read()?.fitMode}`)),
		ref: computed({
			get: () => read()?.fitMode,
			set: (fitMode: NodeOutputReference['fitMode']) => {
				const connection = read();
				if (connection) update({ ...connection, fitMode });
			},
		}),
		options: [{ label: i18n.t('_FitModes.stretch'), value: 'stretch' }, { label: i18n.t('_FitModes.cover'), value: 'cover' }, { label: i18n.t('_FitModes.contain'), value: 'contain' }],
	}, {
		type: 'radio',
		text: 'Wrap Mode',
		disabled,
		caption: computed(() => i18n.t(`_WrapModes.${read()?.wrapMode}`)),
		ref: computed({
			get: () => read()?.wrapMode,
			set: (wrapMode: NodeOutputReference['wrapMode']) => {
				const connection = read();
				if (connection) update({ ...connection, wrapMode });
			},
		}),
		options: [{ label: i18n.t('_WrapModes.clamp'), value: 'clamp' }, { label: i18n.t('_WrapModes.repeat'), value: 'repeat' }, { label: i18n.t('_WrapModes.repeatMirrored'), value: 'repeatMirrored' }, { label: i18n.t('_WrapModes.transparent'), value: 'transparent' }],
	}, {
		type: 'radio',
		text: 'Filter Mode',
		disabled,
		caption: computed(() => i18n.t(`_FilterModes.${read()?.filterMode}`)),
		ref: computed({
			get: () => read()?.filterMode,
			set: (filterMode: NodeOutputReference['filterMode']) => {
				const connection = read();
				if (connection) update({ ...connection, filterMode });
			},
		}),
		options: [{ label: i18n.t('_FilterModes.linear'), value: 'linear' }, { label: i18n.t('_FilterModes.nearest'), value: 'nearest' }],
	}];
}
