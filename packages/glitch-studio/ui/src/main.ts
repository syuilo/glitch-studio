import { createApp } from 'vue';
import '@/style.scss';
import App from '@/App.vue';
import directives from '@/directives/index.ts';
import '@tabler/icons-webfont/dist/tabler-icons.scss';

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

const app = createApp(App);

directives(app);

app.mount('#app');
