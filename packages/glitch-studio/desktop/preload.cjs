const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 汎用的なIPC送信口ではなく、UIに必要な操作だけを公開する。
contextBridge.exposeInMainWorld('desktop', {
	// FileをIPCへ送るとネイティブな情報が失われるため、preload内で元ファイルのパスを取得する。
	getPathForFile: (file) => webUtils.getPathForFile(file),
	showTestAlert: () => ipcRenderer.invoke('desktop:show-test-alert'),
	openDevTools: () => ipcRenderer.invoke('desktop:open-dev-tools'),
	toggleDevTools: () => ipcRenderer.invoke('desktop:toggle-dev-tools'),
	zoomIn: () => ipcRenderer.invoke('desktop:zoom-in'),
	zoomOut: () => ipcRenderer.invoke('desktop:zoom-out'),
});
