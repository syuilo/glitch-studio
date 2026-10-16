import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const executeFile = promisify(execFile);

function listen(pipeName) {
	return new Promise((resolve, reject) => {
		const server = net.createServer(socket => socket.end());
		server.once('error', reject);
		server.listen(pipeName, () => resolve(server));
	});
}

function isListening(pipeName) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(pipeName);
		const finish = value => { socket.destroy(); resolve(value); };
		socket.once('connect', () => finish(true));
		socket.once('error', error => {
			if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) finish(false);
			else { socket.destroy(); reject(error); }
		});
		socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Desktop instance check timed out')); });
	});
}

async function isInstallerRunning(installerPath) {
	// パスはコマンドへ展開せず環境変数で渡す。別のアプリのインストーラーを同名だけで判定しない。
	const { stdout } = await executeFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
		"$ErrorActionPreference = 'Stop'; $found = @(Get-CimInstance Win32_Process -Filter \"Name LIKE '%.exe'\" | Where-Object { $_.ExecutablePath -eq $env:GLITCH_UPDATE_INSTALLER_PATH }); if ($found.Count -gt 0) { 'running' }"],
	{ windowsHide: true, timeout: 10000, env: { ...process.env, GLITCH_UPDATE_INSTALLER_PATH: installerPath } });
	return stdout.trim() === 'running';
}

/** 同じ実行ファイルを使う編集プロセスだけを登録し、更新と新規起動を同じ排他で直列化する。 */
export class DesktopInstances {
	constructor({ executablePath, userDataPath, version, installerRunning = isInstallerRunning, now = Date.now }) {
		const installationId = createHash('sha256').update(path.resolve(executablePath).toLowerCase()).digest('hex').slice(0, 24);
		this.directory = path.join(userDataPath, 'desktop-instances', installationId);
		this.pipePrefix = process.platform === 'win32' ? `\\\\.\\pipe\\glitch-studio-${installationId}` : path.join(os.tmpdir(), `gs-${installationId}`);
		this.id = randomUUID();
		this.pipeName = `${this.pipePrefix}-${this.id}`;
		this.version = version;
		this.installerRunning = installerRunning;
		this.now = now;
		this.server = null;
	}

	async exclusive(operation) {
		// OSの名前付きパイプを短いトランザクションのmutexとして使う。
		// ファイルをmutexにすると異常終了時の古いロックを消す処理自体が競合するため使わない。
		let gate = null;
		for (let attempt = 0; attempt < 250; attempt++) {
			try { gate = await listen(`${this.pipePrefix}-gate`); break; }
			catch (error) {
				if (error.code !== 'EADDRINUSE') throw error;
				await delay(20);
			}
		}
		if (gate == null) throw new Error('Desktop instance coordination timed out');
		try { return await operation(); }
		finally { await new Promise(resolve => gate.close(resolve)); }
	}

	async readUpdate() {
		try { return JSON.parse(await fs.readFile(path.join(this.directory, 'update.json'), 'utf8')); }
		catch (error) { if (error.code === 'ENOENT') return null; throw error; }
	}

	async writeJson(name, value) {
		const filePath = path.join(this.directory, name);
		const temporaryPath = `${filePath}.${this.id}.tmp`;
		await fs.writeFile(temporaryPath, JSON.stringify(value));
		// 異常終了による途中のJSONを次回起動が読まないよう、確定済みの登録だけを公開する。
		await fs.rename(temporaryPath, filePath);
	}

	async hasActiveUpdate() {
		const update = await this.readUpdate();
		if (update == null) return false;
		if (await isListening(update.pipeName)) return true;
		if (update.installerPath != null && update.version === this.version) {
			// quitAndInstallで元プロセスが終了した後も排他を引き継ぐ。
			// 起動直前の猶予とインストーラーの生存確認を分け、失敗後に永久ロックを残さない。
			if (this.now() - update.handoffTime < 30000 || await this.installerRunning(update.installerPath)) return true;
		}
		await fs.unlink(path.join(this.directory, 'update.json'));
		return false;
	}

	async register() {
		await fs.mkdir(this.directory, { recursive: true });
		this.server = await listen(this.pipeName);
		return this.exclusive(async () => {
			if (await this.hasActiveUpdate()) return false;
			await this.writeJson(`${this.id}.json`, { pipeName: this.pipeName });
			return true;
		});
	}

	async acquireUpdate() {
		return this.exclusive(async () => {
			if (await this.hasActiveUpdate()) return false;
			for (const name of await fs.readdir(this.directory)) {
				if (name === 'update.json' || name === `${this.id}.json` || !name.endsWith('.json')) continue;
				const filePath = path.join(this.directory, name);
				const instance = JSON.parse(await fs.readFile(filePath, 'utf8'));
				if (await isListening(instance.pipeName)) return false;
				await fs.unlink(filePath);
			}
			await this.writeUpdate(null);
			return true;
		});
	}

	async writeUpdate(installerPath) {
		await this.writeJson('update.json', {
			id: this.id, pipeName: this.pipeName, version: this.version, installerPath, handoffTime: this.now(),
		});
	}

	async handoff(installerPath) { await this.exclusive(() => this.writeUpdate(installerPath)); }

	async releaseUpdate() {
		await this.exclusive(async () => {
			if ((await this.readUpdate())?.id === this.id) await fs.unlink(path.join(this.directory, 'update.json'));
		});
	}

	async dispose() {
		if (this.server != null) await new Promise(resolve => this.server.close(resolve));
		this.server = null;
		await fs.rm(path.join(this.directory, `${this.id}.json`), { force: true });
	}
}
