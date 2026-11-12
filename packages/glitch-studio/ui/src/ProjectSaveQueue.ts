/** 手動保存と自動バックアップを直列化する。保存先と手動保存の受付は呼び出し側が管理する。 */
export class ProjectSaveQueue {
	private queue: Promise<unknown> = Promise.resolve();

	public async whenIdle(): Promise<void> { await this.queue; }

	// 自動バックアップ中に受け付けた手動保存を待機させ、失敗したジョブで後続を止めない。
	public runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => {});
		return result;
	}
}
