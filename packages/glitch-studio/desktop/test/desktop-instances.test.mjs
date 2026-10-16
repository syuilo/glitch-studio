import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopInstances } from '../desktop-instances.mjs';

async function fixture(t) {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-instances-test-'));
	const instances = [];
	const make = options => {
		const instance = new DesktopInstances({ executablePath: path.join(directory, 'Glitch Studio.exe'), userDataPath: directory,
			version: '2.0.0-alpha.1', ...options });
		instances.push(instance);
		return instance;
	};
	t.after(async () => {
		for (const instance of instances) await instance.dispose();
		assert.equal(path.dirname(directory), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-instances-test-'));
		await fs.rm(directory, { recursive: true, force: true });
	});
	return { make, directory };
}

// 【複数の編集は許可し、同じインストール先の別プロセスがいると更新を拒否する】
// 単一インスタンスへ変更せず、インストーラーに別の編集プロセスを強制終了させない。
test('allows multiple editors but updates only with one registered instance', async t => {
	const f = await fixture(t);
	const first = f.make();
	const second = f.make();
	assert.equal(await first.register(), true);
	assert.equal(await second.register(), true);
	assert.equal(await first.acquireUpdate(), false);
	await second.dispose();
	assert.equal(await first.acquireUpdate(), true);
	assert.equal(await f.make().register(), false);
	await first.releaseUpdate();
	assert.equal(await f.make().register(), true);
});

// 【更新開始と新規起動の同時受付でも、両方を許可しない】
// 生存確認と更新ロック作成を別々に行うと、その隙間に別の編集プロセスが起動できてしまう。
test('serializes a new editor racing with an update', async t => {
	const f = await fixture(t);
	const first = f.make();
	const second = f.make();
	await first.register();
	const [updated, registered] = await Promise.all([first.acquireUpdate(), second.register()]);
	assert.equal(updated && registered, false);
	assert.equal(updated || registered, true);
});

// 【異常終了した登録は生存パイプがないことを確認して除去する】
// PIDの再利用や古い登録ファイルで、以降のアップデートを永久に拒否しない。
test('removes stale registrations after a crashed instance', async t => {
	const f = await fixture(t);
	const crashed = f.make();
	await crashed.register();
	await new Promise(resolve => crashed.server.close(resolve));
	crashed.server = null;
	const current = f.make();
	await current.register();
	assert.equal(await current.acquireUpdate(), true);
	assert.equal((await fs.readdir(current.directory)).includes(`${crashed.id}.json`), false);
});

// 【インストーラーへの引き継ぎ後も旧版の新規起動を拒否し、更新後の起動と失敗からの復帰を許可する】
// 元プロセスが終了すると名前付きパイプも消えるため、インストール中の排他は別途必要になる。
test('preserves the install handoff across process exit without leaving a permanent lock', async t => {
	const f = await fixture(t);
	let now = 100000;
	const first = f.make({ now: () => now });
	await first.register();
	await first.acquireUpdate();
	await first.handoff('installer.exe');
	await first.dispose();
	assert.equal(await f.make({ now: () => now, installerRunning: async () => false }).register(), false);
	now += 31000;
	assert.equal(await f.make({ now: () => now, installerRunning: async () => true }).register(), false);
	const recovered = f.make({ now: () => now, installerRunning: async () => false });
	assert.equal(await recovered.register(), true);
	await recovered.acquireUpdate();
	await recovered.handoff('installer.exe');
	await recovered.dispose();
	assert.equal(await f.make({ version: '2.0.0-alpha.2', now: () => now, installerRunning: async () => true }).register(), true);
});
