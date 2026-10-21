import { BaseWindow, ImageView, nativeImage } from 'electron';

export function createStartupSplash({ mainWindow, imagePath }) {
	if (mainWindow.isDestroyed() || mainWindow.isVisible()) return null;
	let startupSplash = null;
	try {
		// ロゴと文字を含めて事前に画像化し、HTMLの読み込みや
		// スプラッシュ専用のレンダラープロセスの起動を待たずに表示する。
		const image = nativeImage.createFromPath(imagePath);
		if (image.isEmpty()) throw new Error(`Could not load the startup splash image: ${imagePath}`);
		startupSplash = new BaseWindow({
			width: 400,
			height: 280,
			show: false,
			frame: false,
			resizable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			closable: false,
			skipTaskbar: true,
			title: 'Glitch Studio',
			backgroundColor: '#000',
		});
		const imageView = new ImageView();
		imageView.setBackgroundColor('#000');
		imageView.setImage(image);
		startupSplash.setContentView(imageView);
		const destroyStartupSplash = () => {
			if (!startupSplash.isDestroyed()) startupSplash.destroy();
		};
		mainWindow.once('show', destroyStartupSplash);
		mainWindow.once('closed', destroyStartupSplash);
		startupSplash.once('closed', () => {
			mainWindow.removeListener('show', destroyStartupSplash);
			mainWindow.removeListener('closed', destroyStartupSplash);
		});
		// BaseWindow + ImageViewにはready-to-showを待つ必要がない。
		// 画像を設定してから表示し、黒い背景だけのウィンドウが先に出ることも避ける。
		startupSplash.show();
		return startupSplash;
	} catch (error) {
		console.error('Failed to load the startup splash:', error);
		if (startupSplash != null && !startupSplash.isDestroyed()) startupSplash.destroy();
		return null;
	}
}
