import { computed } from 'vue';
import type { NodeOutputReference } from '@glitch/shared/types.ts';
import type { MenuItem } from '@/types/menu.ts';

/** メニュー表示中のUndoや接続変更にも追従し、変更時には最新の接続情報を保持する。 */
export function inputSamplingMenu(read: () => NodeOutputReference | null, update: (connection: NodeOutputReference) => void): MenuItem[] {
	const disabled = computed(() => read() == null);
	return [{
		type: 'radio', text: 'Fit mode', disabled,
		ref: computed({
			get: () => read()?.fitMode ?? 'cover',
			set: (fitMode: NonNullable<NodeOutputReference['fitMode']>) => {
				const connection = read();
				if (connection) update({ ...connection, fitMode });
			},
		}),
		options: [{ label: 'Stretch', value: 'stretch' }, { label: 'Cover', value: 'cover' }, { label: 'Contain', value: 'contain' }],
	}, {
		type: 'radio', text: 'Wrap mode', disabled,
		ref: computed({
			get: () => read()?.wrapMode ?? 'repeatMirrored',
			set: (wrapMode: NonNullable<NodeOutputReference['wrapMode']>) => {
				const connection = read();
				if (connection) update({ ...connection, wrapMode });
			},
		}),
		options: [{ label: 'Clamp', value: 'clamp' }, { label: 'Repeat', value: 'repeat' }, { label: 'Repeat mirrored', value: 'repeatMirrored' }, { label: 'Transparent', value: 'transparent' }],
	}];
}
