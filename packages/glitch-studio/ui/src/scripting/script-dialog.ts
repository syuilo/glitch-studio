import GsDialog from '../components/common/GsDialog.vue';
import { popup } from '../ui.ts';
import { i18n } from '../i18n.ts';
import type { ProjectSessionContext } from '../ProjectSessionContext.ts';
import type { ScriptDialogHandler } from './script-dialog-types.ts';

export function createProjectScriptDialogHandler(session: ProjectSessionContext): ScriptDialogHandler {
	return (request, signal) => new Promise(resolve => {
		if (signal.aborted || session.isDisposed) { resolve(null); return; }
		let settled = false;
		const finish = (value: string | boolean | null) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			resolve(value);
		};
		const abort = () => { finish(null); dispose(); };
		const { dispose } = popup(GsDialog, {
			title: request.kind === 'error' ? i18n.ts._Scripting.Error : i18n.ts._Scripting.Title,
			text: request.text,
			type: request.kind === 'error' ? 'error' : request.kind === 'confirm' ? 'question' : 'info',
			showCancelButton: request.kind === 'confirm',
			...(request.kind === 'inputText' ? { input: { type: 'text' as const, default: request.defaultValue } } : {}),
			...(request.kind === 'select' ? { select: {
				items: request.items.map(item => ({ value: item.id, label: item.label })),
				default: request.defaultId ?? request.items[0].id,
			} } : {}),
		}, {
			done: result => {
				if (request.kind === 'confirm') finish(result?.canceled === false);
				else if (request.kind === 'inputText' || request.kind === 'select') finish(result?.canceled === false ? String(result.result ?? '') : null);
				else finish(null);
			},
			closed: () => { finish(request.kind === 'confirm' ? false : null); dispose(); },
		}, session);
		signal.addEventListener('abort', abort, { once: true });
	});
}
