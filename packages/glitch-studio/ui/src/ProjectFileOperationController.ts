import { readonly, ref } from 'vue';

/** ウィンドウ内の新規作成・Open・Save・Closeを一つだけ受け付ける。編集とタブ選択は制限しない。 */
export class ProjectFileOperationController {
	private readonly busy = ref(false);
	public readonly isBusy = readonly(this.busy);

	public tryBegin(): (() => void) | null {
		if (this.busy.value) return null;
		// ダイアログを開く前に同期的に確保する。追加要求はキューへ積まず、
		// 操作時点とは異なる保存先やユーザー操作権限で後から実行しない。
		this.busy.value = true;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.busy.value = false;
		};
	}

	public async run<T>(operation: () => Promise<T>): Promise<T | null> {
		const release = this.tryBegin();
		if (release == null) return null;
		try { return await operation(); } finally { release(); }
	}
}
