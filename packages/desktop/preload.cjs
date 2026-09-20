const { contextBridge, ipcRenderer } = require('electron');

// 汎用的なIPC送信口ではなく、UIに必要な操作だけを公開する。
contextBridge.exposeInMainWorld('desktop', {
	showTestAlert: () => ipcRenderer.invoke('desktop:show-test-alert'),
	openDevTools: () => ipcRenderer.invoke('desktop:open-dev-tools'),
});
