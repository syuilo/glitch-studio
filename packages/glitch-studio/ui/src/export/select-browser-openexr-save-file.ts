import GsOpenExrSaveDialog from '../components/GsOpenExrSaveDialog.vue';
import { popup } from '../ui.ts';
import type { BrowserExportFileTarget } from './browser-export-file.ts';

export function selectBrowserOpenExrSaveFile(name: string): Promise<BrowserExportFileTarget | null> {
	return new Promise(resolve => {
		const { dispose } = popup(GsOpenExrSaveDialog, { name: name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') }, {
			selected: target => resolve(target),
			closed: () => { resolve(null); dispose(); },
		});
	});
}
