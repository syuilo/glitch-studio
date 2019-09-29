// MAIN BACKGROUND PROCESS

import { app, protocol, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import {
	createProtocol,
	installVueDevtools
} from 'vue-cli-plugin-electron-builder/lib';
const unhandled = require('electron-unhandled');
import { settingsStore, userDataPath } from './settings';

unhandled();

const isDevelopment = process.env.NODE_ENV !== 'production';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([{
	scheme: 'app', privileges: { secure: true, standard: true }
}]);

function createWindow() {
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

let showAllParams = true;
let showHistogram = false;
let presets = settingsStore.settings.presets;

function renderMenu() {
	const menu = Menu.buildFromTemplate([{
		label: 'File',
		submenu: [{
			label: 'Open Image',
			accelerator: 'Ctrl+O',
			click: () => {
				win!.webContents.send('openImage');
			}
		}, {
			label: 'Save Image',
			accelerator: 'Ctrl+S',
			click: () => {
				win!.webContents.send('saveImage');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Save Preset',
			click: () => {
				win!.webContents.send('savePreset');
			}
		}, {
			label: 'Export Preset',
			click: () => {
				win!.webContents.send('exportPreset');
			}
		}, {
			label: 'Import Preset',
			click: () => {
				win!.webContents.send('importPreset');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Remove Preset',
			submenu: presets.length === 0 ? [{
				label: 'No presets',
				enabled: false
			}] : presets.map(p => ({
				label: p.name,
				click: () => {
					win!.webContents.send('removePreset', p.id);
				},
			}))
		}, {
			type: 'separator'
		}, {
			role: 'quit'
		}]
	}, {
		label: 'Edit',
		submenu: [{
			label: 'Undo',
			accelerator: 'Ctrl+Z',
			click: () => {
				win!.webContents.send('undo');
			}
		}, {
			label: 'Redo',
			accelerator: 'Ctrl+Y',
			click: () => {
				win!.webContents.send('redo');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Randomize All',
			enabled: false,
		}, {
			label: 'Randomize World',
			enabled: false,
		}, {
			type: 'separator'
		}, {
			label: 'Init',
			accelerator: 'Ctrl+N',
			click: () => {
				win!.webContents.send('init');
			}
		}]
	}, {
		label: 'View',
		submenu: [{
			label: 'Show All Params',
			type: 'checkbox',
			checked: showAllParams,
			click: () => {
				showAllParams = !showAllParams;
				win!.webContents.send('changeShowAllParams', showAllParams);
				renderMenu();
			}
		}, {
			label: 'Show Histogram',
			type: 'checkbox',
			checked: settingsStore.settings.showHistogram,
			click: () => {
				settingsStore.settings.showHistogram = !settingsStore.settings.showHistogram;
				win!.webContents.send('changeShowHistogram', settingsStore.settings.showHistogram);
				renderMenu();
			}
		}, {
			type: 'separator'
		}, {
			label: 'Collapse All FX',
			click: () => {
				win!.webContents.send('collapseAllFx');
			}
		}, {
			label: 'Expand All FX',
			click: () => {
				win!.webContents.send('expandAllFx');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Zoom In',
			role: 'zoomIn',
			click: () => {
				win!.webContents.send('zoomIn');
			}
		}, {
			label: 'Zoom Out',
			role: 'zoomOut',
			click: () => {
				win!.webContents.send('zoomOut');
			}
		}, {
			label: 'Reset Zoom',
			role: 'resetZoom',
			click: () => {
				win!.webContents.send('resetZoom');
			}
		}, {
			type: 'separator'
		}, {
			label: 'Toggle Fullscreen',
			role: 'togglefullscreen',
		}]
	}, {
		label: 'Presets',
		submenu: presets.length === 0 ? [{
			label: 'No presets',
			enabled: false
		}] : presets.map(p => ({
			label: p.name,
			click: () => {
				win!.webContents.send('applyPreset', p.id);
			},
		}))
	}, {
		label: 'Help',
		submenu: [{
			label: 'Open Data Folder',
			click: () => {
				shell.openItem(userDataPath);
			}
		}, {
			label: 'Toggle Developer Tools',
			role: 'toggleDevTools',
		}, {
			type: 'separator',
		}, {
			label: 'Report Issue',
			click: () => {
				shell.openExternal('https://github.com/syuilo/glitch-studio/issues/new?assignees=&labels=⚠️bug%3F&template=01_bug-report.md&title=');
			}
		}, {
			label: 'Feature Request',
			click: () => {
				shell.openExternal('https://github.com/syuilo/glitch-studio/issues/new?assignees=&labels=✨enhancement%3F&template=02_feature-request.md&title=');
			}
		}, {
			type: 'separator',
		}, {
			label: 'Support Us on Patreon',
			click: () => {
				shell.openExternal('https://www.patreon.com/syuilo');
			}
		}, {
			type: 'separator',
		}, {
			label: 'About',
			role: 'about',
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
});

app.on('activate', () => {
	// On macOS it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (win === null) {
		createWindow();
	}
});

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

	renderMenu();

	createWindow();
});

app.on('before-quit', () => {
	settingsStore.save();
});

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

ipcMain.on('updatePresets', (ev, _presets) => {
	presets = _presets;
	renderMenu();
});
