import { createApp } from 'vue';
import '@/style.scss';
import App from '@/App.vue';
import directives from '@/directives/index.ts';
import { desktopUpdateUi } from './desktop-update-ui.ts';

const onVisibilityChange = () => window.document.addEventListener('visibilitychange', () => {
	if (window.document.visibilityState === 'visible') {
		navigator.wakeLock.request('screen');
	}
});
navigator.wakeLock.request('screen')
	.then(onVisibilityChange)
	.catch(() => {
		// On WebKit-based browsers, user activation is required to send wake lock request
		// https://webkit.org/blog/13862/the-user-activation-api/
		window.document.addEventListener(
			'click',
			() => navigator.wakeLock.request('screen').then(onVisibilityChange),
			{ once: true },
		);
	});

document.documentElement.toggleAttribute('data-web', !__ELECTRON__);

const app = createApp(App);

if (__ELECTRON__ && window.desktop != null) {
	const rootElement = document.documentElement;
	let needsInitialState = true;
	const updateWindowMaximizedAttribute = (maximized: boolean) => {
		needsInitialState = false;
		rootElement.toggleAttribute('data-window-maximized', maximized);
	};
	// 起動時の最大化も受け取れるよう先に購読し、初期値の応答が遅れても通知済みの状態を上書きしない。
	const stopWatchingWindowMaximized = window.desktop.onWindowMaximizedChanged(updateWindowMaximizedAttribute);
	void window.desktop.isWindowMaximized().then(maximized => {
		if (needsInitialState) updateWindowMaximizedAttribute(maximized);
	}).catch(console.error);
	app.onUnmount(() => {
		needsInitialState = false;
		stopWatchingWindowMaximized();
		rootElement.removeAttribute('data-window-maximized');
	});
}

directives(app);

app.mount('#app');

// ダイアログの表示先ができてから、画面のライフサイクルに依存しない更新サービスを開始する。
void desktopUpdateUi?.initialize().catch(console.error);
