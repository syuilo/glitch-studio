import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';

// OS操作だけを担当する。保存間隔・期限の判定はUI側のバックアップ管理に集約する。
export class ProjectFiles {
	#projects = new Map();

	register(filePath) {
		if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.gsproj') {
			throw new Error('Invalid project file path');
		}
		const normalized = path.normalize(filePath);
		for (const [id, stored] of this.#projects) if (stored === normalized) return id;
		const id = randomUUID();
		this.#projects.set(id, normalized);
		return id;
	}

	clear() { this.#projects.clear(); }

	describe(id) { return { id, name: path.basename(this.#project(id)) }; }

	async exists(id) {
		try { await fs.stat(this.#project(id)); return true; } catch (error) {
			if (error.code === 'ENOENT') return false;
			throw error;
		}
	}

	async read(id) {
		try { return await fs.readFile(this.#project(id)); } catch (error) {
			if (error.code === 'ENOENT') return null;
			throw error;
		}
	}

	async write(id, data) {
		const destination = this.#project(id);
		if (!(data instanceof Uint8Array) || !data.byteLength) throw new Error('The project contains no save data');
		const temporary = path.join(path.dirname(destination), `.glitch-studio-save-${randomUUID()}.tmp`);
		let file;
		try {
			file = await fs.open(temporary, 'wx');
			await file.writeFile(data);
			await file.sync();
			await file.close();
			file = null;
			// 元ファイルを先に削除しない。同じフォルダ内で完成した一時ファイルと置き換える。
			await fs.rename(temporary, destination);
		} finally {
			await file?.close().catch(() => {});
			await fs.unlink(temporary).catch(() => {});
		}
	}

	#project(id) {
		const project = this.#projects.get(id);
		if (!project) throw new Error('Unknown project backup target');
		return project;
	}

	#backupPath(id, name) {
		const project = this.#project(id);
		const prefix = `${path.basename(project, path.extname(project))}.`;
		// Rendererから任意のパスや本体の削除を要求できないよう、登録ファイルの兄弟に限定する。
		// 日時の意味と期限はUIが検証し、ここではOS境界として許可するファイル名の範囲だけ検証する。
		if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || !name.startsWith(prefix)
			|| !/^(auto|save)-backup-\d{4}(?:-\d{2}){5}(?:-[1-9]\d*)?\.gsproj$/.test(name.slice(prefix.length))) {
			throw new Error('Invalid project backup name');
		}
		return path.join(path.dirname(project), name);
	}

	async list(id) {
		const entries = await fs.readdir(path.dirname(this.#project(id)), { withFileTypes: true });
		return entries.filter(entry => entry.isFile()).map(entry => entry.name);
	}

	async create(id, name, data) {
		const destination = this.#backupPath(id, name);
		if (!(data instanceof Uint8Array) || !data.byteLength) throw new Error('The backup contains no save data');
		const temporary = path.join(path.dirname(destination), `.glitch-studio-backup-${randomUUID()}.tmp`);
		let file;
		try {
			file = await fs.open(temporary, 'wx');
			await file.writeFile(data);
			await file.sync();
			await file.close();
			file = null;
			// renameは既存の宛先を上書きするため使わない。linkは同名なら失敗し、完成した内容だけを公開する。
			// ハードリンク非対応の外部ドライブ等では、既存宛先を拒否するコピーを使う。
			try { await fs.link(temporary, destination); } catch (error) {
				if (error.code === 'EEXIST') return false;
				if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(error.code)) throw error;
				try { await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL); } catch (copyError) {
					if (copyError.code === 'EEXIST') return false;
					throw copyError;
				}
			}
			return true;
		} finally {
			await file?.close().catch(() => {});
			await fs.unlink(temporary).catch(() => {});
		}
	}

	async remove(id, name) {
		const target = this.#backupPath(id, name);
		try {
			// ディレクトリやシンボリックリンクを追跡せず、通常ファイルだけを削除する。
			if (!(await fs.lstat(target)).isFile()) return;
			await fs.unlink(target);
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
}
