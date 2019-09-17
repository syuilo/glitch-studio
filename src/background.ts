'use strict';

import { app, protocol, BrowserWindow, Menu, ipcMain } from 'electron';
import {
	createProtocol,
	installVueDevtools
} from 'vue-cli-plugin-electron-builder/lib';
import { fxs } from './glitch/fxs';
import { settingsStore } from './settings';

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: { secure: true, standard: true } }]);

function createWindow () {
	// Create the browser window.
	win = new BrowserWindow({
		width: 1000, height: 700,
		title: 'Glitch Studio',
		icon: __dirname + '/../icon.png',
		frame: false,
		webPreferences: {
			nodeIntegration: true,
			webSecurity: false
		}
	});

	if (process.env.WEBPACK_DEV_SERVER_URL) {
		// Load the url of the dev server if in development mode
		win.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string);
		if (!process.env.IS_TEST) win.webContents.openDevTools();
	} else {
		createProtocol('app');
		// Load the index.html when not in development
		win.loadURL('app://./index.html');
	}

	win.on('closed', () => {
		win = null;
	});
}

function renderMenu(presets: { id: string; name: string; }[]) {
	const menu = Menu.buildFromTemplate([{
		label: 'File',
		submenu: [{
			label: 'Open image',
			click: () => {
				win!.webContents.send('openImage');
			}
		}, {
			label: 'Save image',
			click: () => {
				win!.webContents.send('saveImage');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Save preset',
			click: () => {
				win!.webContents.send('savePreset');
			}
		}, {
			label: 'Export preset',
			click: () => {
				win!.webContents.send('exportPreset');
			}
		}, {
			label: 'Import preset',
			click: () => {
				win!.webContents.send('importPreset');
			}
		}, {
			type: 'separator'
		}, {
			role: 'quit'
		}]
	}, {
		label: 'Edit',
		submenu: [{
			label: 'Undo',
			click: () => {
				win!.webContents.send('undo');
			}
		}, {
			label: 'Redo',
			click: () => {
				win!.webContents.send('redo');
			}
		}]
	}, {
		label: 'FX',
		submenu: Object.entries(fxs).map(([k, v]) => ({
			label: v.displayName,
			click: () => {
				win!.webContents.send('addFx', v.name);
			}
		}))
	}, {
		label: 'Presets',
		submenu: presets.map(p => ({
			label: p.name,
			click: () => {
				win!.webContents.send('applyPreset', p.id);
			}
		}))
	}, {
		label: 'Help',
		submenu: [{
			label: 'About',
			click: () => {
				win!.webContents.send('about');
			}
		}]
	}]);

	Menu.setApplicationMenu(menu);
	if (win) win.webContents.send('updateMenu');
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
	// On macOS it is common for applications and their menu bar
	// to stay active until the user quits explicitly with Cmd + Q
	if (process.platform !== 'darwin') {
		app.quit();
	}
})

app.on('activate', () => {
	// On macOS it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (win === null) {
		createWindow();
	}
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
	if (isDevelopment && !process.env.IS_TEST) {
		// Install Vue Devtools
		// Devtools extensions are broken in Electron 6.0.0 and greater
		// See https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/378 for more info
		// Electron will not launch with Devtools extensions installed on Windows 10 with dark mode
		// If you are not using Windows 10 dark mode, you may uncomment these lines
		// In addition, if the linked issue is closed, you can upgrade electron and uncomment these lines
		// try {
		//   await installVueDevtools()
		// } catch (e) {
		//   console.error('Vue Devtools failed to install:', e.toString())
		// }

	}

	renderMenu(settingsStore.settings.presets);

	createWindow();
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
	if (process.platform === 'win32') {
		process.on('message', data => {
			if (data === 'graceful-exit') {
				app.quit();
			}
		});
	} else {
		process.on('SIGTERM', () => {
			app.quit();
		});
	}
}

ipcMain.on('updatePresets', (ev, presets) => {
	renderMenu(presets);
});
