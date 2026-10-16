/** アプリを終了する更新と、途中で終了できない読込・書き出しの受付を調整する。 */
export class ApplicationActivity {
	private activeOperations = 0;
	private updating = false;

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
