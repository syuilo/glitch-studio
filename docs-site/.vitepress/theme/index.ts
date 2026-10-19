import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import type { Theme } from 'vitepress';
import HomeSlideshow from './components/HomeSlideshow.vue';
import './style.css';

export default {
	extends: DefaultTheme,
	Layout: () => h(DefaultTheme.Layout, null, {
		'home-hero-after': () => h(HomeSlideshow),
	}),
} satisfies Theme;
