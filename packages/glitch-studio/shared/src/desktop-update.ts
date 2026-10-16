/** Electron固有のオブジェクトや配布URLをUIへ公開せず、表示と操作に必要な状態だけを渡す。 */
export type DesktopUpdateState = {
	revision: number;
	phase: 'disabled' | 'idle' | 'checking' | 'not-available' | 'available' | 'preparing' | 'downloading' | 'installing' | 'error' | 'restart-required';
	version: string | null;
	progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
	error: { code: 'check-failed' | 'download-failed' | 'install-failed' | 'other-instances' | 'preparation-failed'; message: string } | null;
};
