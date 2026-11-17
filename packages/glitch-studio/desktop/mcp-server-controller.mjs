import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { startMcpHttpServer } from './mcp-http-server.mjs';

const defaultSettings = { enabled: false, port: 45721, allowEditing: false };

function validateSettings(value) {
	if (value == null || typeof value.enabled !== 'boolean' || typeof value.allowEditing !== 'boolean'
		|| !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('MCP port must be an integer between 1024 and 65535, and switches must be booleans.');
	return { enabled: value.enabled, port: value.port, allowEditing: value.allowEditing };
}

/** アプリ単位の設定・認証情報とHTTPサーバーの寿命を所有する。 */
export class McpServerController extends EventEmitter {
	constructor({ filePath, invoke, version, startServer = startMcpHttpServer }) {
		super();
		this.filePath = filePath;
		this.invoke = invoke;
		this.version = version;
		this.startServer = startServer;
		this.settings = { ...defaultSettings };
		this.token = randomBytes(32).toString('hex');
		this.status = 'stopped';
		this.error = null;
		this.activity = [];
		this.revision = 0;
		this.server = null;
		this.requests = new globalThis.AbortController();
		this.pendingChange = null;
		this.disposed = false;
	}

	getState() {
		return globalThis.structuredClone({ revision: this.revision, settings: this.settings, status: this.status,
			url: `http://127.0.0.1:${this.settings.port}/mcp`, token: this.token, error: this.error, activity: this.activity });
	}

	notify() {
		this.revision++;
		this.emit('state', this.getState());
	}

	change(run) {
		if (this.disposed) return Promise.reject(new Error('MCP server has been disposed.'));
		if (this.pendingChange != null) return Promise.reject(new Error('MCP settings are being updated. Try again.'));
		this.pendingChange = Promise.resolve().then(run).finally(() => { this.pendingChange = null; });
		return this.pendingChange;
	}

	initialize() {
		return this.change(async () => {
			try {
				let saved = null;
				try { saved = JSON.parse(await fs.readFile(this.filePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
				if (saved != null) {
					const settings = validateSettings(saved.settings);
					if (typeof saved.token !== 'string' || !/^[a-f0-9]{64}$/.test(saved.token)) throw new Error('Invalid stored MCP token. Reconfigure the MCP server.');
					this.settings = settings;
					this.token = saved.token;
				} else if (!this.disposed) await this.save(this.settings, this.token);
				if (!this.disposed) await this.restart();
			} catch (error) {
				// 壊れた設定から推測して待受を開始しない。編集アプリ自体の起動は続行する。
				this.error = error.message;
				this.status = 'error';
				this.notify();
			}
			return this.getState();
		});
	}

	async save(settings, token) {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
		try {
			await fs.writeFile(temporaryPath, JSON.stringify({ settings, token }), { mode: 0o600 });
			await fs.rename(temporaryPath, this.filePath);
		} finally {
			await fs.rm(temporaryPath, { force: true });
		}
	}

	setSettings(value) {
		let settings;
		try { settings = validateSettings(value); } catch (error) { return Promise.reject(error); }
		return this.change(async () => {
			await this.save(settings, this.token);
			this.settings = settings;
			if (!this.disposed) await this.restart();
			return this.getState();
		});
	}

	regenerateToken() {
		return this.change(async () => {
			const token = randomBytes(32).toString('hex');
			await this.save(this.settings, token);
			this.token = token;
			if (!this.disposed) await this.restart();
			return this.getState();
		});
	}

	async stop() {
		this.requests.abort();
		const server = this.server;
		this.server = null;
		if (server != null) await server.close();
	}

	async restart() {
		await this.stop();
		if (this.disposed) return;
		this.error = null;
		this.status = this.settings.enabled ? 'starting' : 'stopped';
		this.notify();
		if (!this.settings.enabled) return;
		const requests = new globalThis.AbortController();
		this.requests = requests;
		try {
			const server = await this.startServer({ ...this.settings, token: this.token, version: this.version,
				invoke: (operation, input, signal) => this.invoke(operation, input, signal == null ? requests.signal : globalThis.AbortSignal.any([signal, requests.signal])),
				onActivity: event => {
					if (this.disposed) return;
					// スクリプト本文・出力・認証情報は操作履歴へ保存しない。
					this.activity = [{ id: randomUUID(), tool: event.tool, startedAt: event.startedAt,
						finishedAt: event.startedAt + event.durationMs, error: event.error }, ...this.activity].slice(0, 50);
					this.notify();
				},
			});
			if (this.disposed) { await server.close(); return; }
			this.server = server;
			this.status = 'running';
		} catch (error) {
			this.error = error.message;
			this.status = 'error';
		}
		this.notify();
	}

	async dispose() {
		this.disposed = true;
		this.requests.abort();
		await this.pendingChange?.catch(() => {});
		await this.stop();
		this.status = 'stopped';
		this.removeAllListeners();
	}
}
