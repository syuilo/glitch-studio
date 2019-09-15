import * as electron from 'electron';

export function chooseFile() {
	return new Promise((res, rej) => {
		const win = electron.remote.BrowserWindow.getFocusedWindow();
		electron.remote.dialog.showOpenDialog(win!, {
				properties: ['openFile'],
				filters: [{
					name: 'Document',
					extensions: ['png', 'jpg']
				}]
			},
			(paths: string[]) => {
				if (paths.length === 0) return rej();
				res(paths[0]);
			}
		);
	});
}
