const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 汎用的なIPC送信口ではなく、UIに必要な操作だけを公開する。
contextBridge.exposeInMainWorld('desktop', {
	// FileをIPCへ送るとネイティブな情報が失われるため、preload内で元ファイルのパスを取得する。
	getPathForFile: (file) => webUtils.getPathForFile(file),
	registerProjectFile: (file) => {
		const filePath = webUtils.getPathForFile(file);
		return filePath ? ipcRenderer.invoke('desktop:register-project-file', filePath) : Promise.resolve(null);
	},
	chooseProjectFile: () => ipcRenderer.invoke('desktop:choose-project-file'),
	chooseProjectSaveFile: (name) => ipcRenderer.invoke('desktop:choose-project-save-file', name),
	readProjectFile: (id) => ipcRenderer.invoke('desktop:read-project-file', id),
	writeProjectFile: (id, data) => ipcRenderer.invoke('desktop:write-project-file', id, data),
	listProjectBackups: (id) => ipcRenderer.invoke('desktop:list-project-backups', id),
	writeProjectBackup: (id, name, data) => ipcRenderer.invoke('desktop:write-project-backup', id, name, data),
	removeProjectBackup: (id, name) => ipcRenderer.invoke('desktop:remove-project-backup', id, name),
	showTestAlert: () => ipcRenderer.invoke('desktop:show-test-alert'),
	openDevTools: () => ipcRenderer.invoke('desktop:open-dev-tools'),
	toggleDevTools: () => ipcRenderer.invoke('desktop:toggle-dev-tools'),
	zoomIn: () => ipcRenderer.invoke('desktop:zoom-in'),
	zoomOut: () => ipcRenderer.invoke('desktop:zoom-out'),
});
