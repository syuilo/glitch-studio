import { computed, ref } from 'vue';

/** アプリ更新との受付を調整し、終了を防ぐための書き出し状態を公開する。 */
export class ApplicationActivity {
	private activeOperations = 0;
	private activeExportCount = ref(0);
	private updating = false;
	public readonly isExporting = computed(() => this.activeExportCount.value > 0);

	acquire(): () => void {
		if (this.updating) throw new Error('Glitch Studio is being updated.');
		this.activeOperations++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeOperations--;
		};
	}

	acquireExport(): () => void {
		const releaseActivity = this.acquire();
		this.activeExportCount.value++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeExportCount.value--;
			releaseActivity();
		};
	}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		const release = this.acquire();
		try { return await operation(); } finally { release(); }
	}

	beginUpdate(): (() => void) | null {
		if (this.updating || this.activeOperations > 0) return null;
		this.updating = true;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.updating = false;
		};
	}
}

export const applicationActivity = new ApplicationActivity();
