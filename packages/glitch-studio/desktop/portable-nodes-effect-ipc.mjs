/** ビルドの寿命を要求元のウィンドウに結び付け、終了・中断時にプロセスを残さない。 */
export function registerPortableNodesEffectIpc(ipcMain, utilityProcess, workerPath, catalogDirectory, getTrustedMainWindow, binaryPath = null) {
	const jobs = new Map();
	ipcMain.handle('desktop:build-portable-nodes-effect', (event, requestId, requirements) => {
		getTrustedMainWindow(event);
		if (typeof requestId !== 'string' || requestId.length === 0) throw new Error('Invalid build request ID');
		const sender = event.sender;
		if (jobs.has(sender.id)) throw new Error('A portable Nodes Effect build is already running');
		return new Promise((resolve, reject) => {
			const child = utilityProcess.fork(workerPath, [catalogDirectory], {
				serviceName: 'Nodes Effect export', stdio: 'pipe',
				// ネイティブのspawnはASARの仮想パスを読めない。配布版では実体を明示する。
				...(binaryPath == null ? {} : { env: { ...process.env, ESBUILD_BINARY_PATH: binaryPath } }),
			});
			let settled = false;
			const finish = (error, runtime = null) => {
				if (settled) return;
				settled = true;
				jobs.delete(sender.id);
				sender.removeListener('destroyed', onDestroyed);
				child.removeAllListeners('message');
				child.kill();
				if (error != null) reject(error);
				else resolve(runtime);
			};
			const onDestroyed = () => finish(new Error('Export window closed'));
			jobs.set(sender.id, { requestId, cancel: () => finish(new Error('Export canceled')) });
			sender.once('destroyed', onDestroyed);
			// バンドラーの診断はmessageで返す。pipeの詰まりで停止しないよう出力は消費する。
			child.stdout?.resume();
			child.stderr?.resume();
			child.once('message', message => {
				if (message.error != null) finish(new Error(message.error));
				else if (typeof message.runtime?.elementSource !== 'string' || typeof message.runtime?.workerSource !== 'string') finish(new Error('Invalid runtime build result'));
				else finish(null, message.runtime);
			});
			child.once('exit', code => finish(new Error(`Runtime builder exited before completing (${code})`)));
			// 起動前にキャンセルされた場合も、実際のspawn後にもう一度終了を要求する。
			child.once('spawn', () => { if (settled) child.kill(); else child.postMessage(requirements); });
		});
	});
	ipcMain.handle('desktop:cancel-portable-nodes-effect', (event, requestId) => {
		getTrustedMainWindow(event);
		const job = jobs.get(event.sender.id);
		if (job?.requestId === requestId) job.cancel();
	});
}
