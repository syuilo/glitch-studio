import GsDialog from '../components/common/GsDialog.vue';
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
		const { dispose } = ui.popup(GsDialog, {
			type: type ?? (request.kind === 'confirm' ? 'question' : 'info'),
			title: request.title,
			text: request.text,
			showCancelButton: request.kind !== 'alert',
			...(request.kind === 'input_text' ? { input: { type: 'text', default: request.defaultValue ?? '' } } : {}),
			...(request.kind === 'select' ? { select: { default: request.defaultValue, items: request.items.map(item => ({ value: item.id, label: item.label })) } } : {}),
		}, {
			done: result => {
				if (request.kind === 'confirm') finish(!result.canceled);
				else if (result.canceled || request.kind === 'alert') finish(null);
				// 未入力の確定も空文字列として扱い、キャンセルのnullとは区別する。
				else if (request.kind === 'input_text') finish(String(result.result ?? ''));
				else finish(typeof result.result === 'string' ? result.result : null);
			},
			closed: () => finish(request.kind === 'confirm' ? false : null),
		}, projectSession);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
