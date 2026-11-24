import GsInputDialog from '../components/common/GsInputDialog.vue';
import GsMessageDialog from '../components/common/GsMessageDialog.vue';
import { i18n } from '../i18n.ts';
import * as ui from '../ui.ts';
import type { ProjectSessionContext } from '../ProjectSessionContext.ts';
import type { ScriptDialogRequest } from './project-script-runtime.ts';

/** パネルを閉じても入力待ちは継続し、編集セッション終了時だけ所属ダイアログを破棄する。 */
export function showProjectScriptDialog(projectSession: ProjectSessionContext, request: ScriptDialogRequest, signal: AbortSignal | null = null, type: 'error' | null = null): Promise<string | boolean | null> {
	if (signal?.aborted === true || projectSession.isDisposed) return Promise.resolve(null);
	return new Promise(resolve => {
		let settled = false;
		const finish = (result: string | boolean | null) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', onAbort);
			resolve(result);
			dispose();
		};
		const onAbort = () => finish(null);
		const { kind, title, text } = request;
		const isConfirm = kind === 'confirm';
		const { dispose } = kind === 'alert' || isConfirm
			? ui.popup(GsMessageDialog, {
				type: type ?? (isConfirm ? 'question' : 'info'),
				title,
				text,
				actions: [
					{ id: 'ok', text: isConfirm ? 'OK' : i18n.ts._Dialog.GotIt, primary: true, isAutofocus: true },
					...(isConfirm ? [{ id: 'cancel', text: i18n.ts.Cancel, isCancel: true }] : []),
				],
				canCancel: true,
			}, {
				done: ({ canceled }) => finish(isConfirm ? !canceled : null),
				closed: () => finish(isConfirm ? false : null),
			}, projectSession)
			: ui.popup(GsInputDialog, {
				title,
				text,
				...(kind === 'input_text' ? { input: { default: request.defaultValue ?? '' } } : {
					select: {
						default: request.defaultValue,
						items: request.items.map(item => ({ value: item.id, label: item.label })),
					},
				}),
			}, {
				done: ({ canceled, result }) => {
					if (canceled) finish(null);
					// 未入力の確定も空文字列として扱い、キャンセルのnullとは区別する。
					else if (kind === 'input_text') finish(String(result ?? ''));
					else finish(typeof result === 'string' ? result : null);
				},
				closed: () => finish(null),
			}, projectSession);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
