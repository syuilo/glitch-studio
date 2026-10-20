const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 汎用的なIPC送信口ではなく、UIに必要な操作だけを公開する。
contextBridge.exposeInMainWorld('desktop', {
	confirmProjectClose: labels => ipcRenderer.sendSync('desktop:confirm-project-close', labels),
	getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
	checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
	prepareUpdate: version => ipcRenderer.invoke('desktop:prepare-update', version),
	startUpdate: () => ipcRenderer.invoke('desktop:start-update'),
	abortUpdatePreparation: () => ipcRenderer.invoke('desktop:abort-update-preparation'),
	onUpdateStateChanged: listener => {
		const handler = (_event, state) => listener(state);
		ipcRenderer.on('desktop:update-state-changed', handler);
		return () => ipcRenderer.removeListener('desktop:update-state-changed', handler);
	},
	voicevoxConnect: endpoint => ipcRenderer.invoke('desktop:voicevox-connect', endpoint),
	voicevoxSynthesize: request => ipcRenderer.invoke('desktop:voicevox-synthesize', request),
	takeStartupProjectFile: () => ipcRenderer.invoke('desktop:take-startup-project-file'),
	// FileをIPCへ送るとネイティブな情報が失われるため、preload内で元ファイルのパスを取得する。
	getPathForFile: (file) => webUtils.getPathForFile(file),
	resolveExternalAsset: (filePath, reload = false) => ipcRenderer.invoke('desktop:resolve-external-asset', filePath, reload),
	assetProjectPaths: (paths, projectId, storing) => ipcRenderer.invoke('desktop:asset-project-paths', paths, projectId, storing),
	chooseAssetFile: previousPath => ipcRenderer.invoke('desktop:choose-asset-file', previousPath),
	beginAssetExport: name => ipcRenderer.invoke('desktop:begin-asset-export', name),
	writeAssetExport: (id, chunk) => ipcRenderer.invoke('desktop:write-asset-export', id, chunk),
	abortAssetExport: id => ipcRenderer.invoke('desktop:abort-asset-export', id),
	registerProjectFile: (file) => {
		const filePath = webUtils.getPathForFile(file);
		return filePath ? ipcRenderer.invoke('desktop:register-project-file', filePath) : Promise.resolve(null);
	},
	chooseProjectFile: () => ipcRenderer.invoke('desktop:choose-project-file'),
	listRecentProjects: () => ipcRenderer.invoke('desktop:list-recent-projects'),
	rememberRecentProject: (id, name) => ipcRenderer.invoke('desktop:remember-recent-project', id, name),
	resolveRecentProject: (id) => ipcRenderer.invoke('desktop:resolve-recent-project', id),
	removeRecentProject: (id) => ipcRenderer.invoke('desktop:remove-recent-project', id),
	clearRecentProjects: () => ipcRenderer.invoke('desktop:clear-recent-projects'),
	chooseProjectSaveFile: (name) => ipcRenderer.invoke('desktop:choose-project-save-file', name),
	readProjectFile: (id) => ipcRenderer.invoke('desktop:read-project-file', id),
	writeProjectFile: (id, data) => ipcRenderer.invoke('desktop:write-project-file', id, data),
	listProjectBackups: (id) => ipcRenderer.invoke('desktop:list-project-backups', id),
	writeProjectBackup: (id, name, data) => ipcRenderer.invoke('desktop:write-project-backup', id, name, data),
	copyProjectBackup: (id, name) => ipcRenderer.invoke('desktop:copy-project-backup', id, name),
	removeProjectBackup: (id, name) => ipcRenderer.invoke('desktop:remove-project-backup', id, name),
	showTestAlert: () => ipcRenderer.invoke('desktop:show-test-alert'),
	openDevTools: () => ipcRenderer.invoke('desktop:open-dev-tools'),
	toggleDevTools: () => ipcRenderer.invoke('desktop:toggle-dev-tools'),
	zoomIn: () => ipcRenderer.invoke('desktop:zoom-in'),
	zoomOut: () => ipcRenderer.invoke('desktop:zoom-out'),
	setProgressBar: (progress) => ipcRenderer.invoke('desktop:set-progress-bar', progress),
	notifyExportComplete: (fileName) => ipcRenderer.invoke('desktop:notify-export-complete', fileName),
	chooseExportSaveFile: (name, format) => ipcRenderer.invoke('desktop:choose-export-save-file', name, format),
	writeExportFile: (id, data) => ipcRenderer.invoke('desktop:write-export-file', id, data),
	releaseExportFile: (id) => ipcRenderer.invoke('desktop:release-export-file', id),
});
