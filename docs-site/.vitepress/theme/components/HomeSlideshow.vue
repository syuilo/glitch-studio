<script setup lang="ts">
import { withBase } from 'vitepress';
import VPSwiper from '@cssnr/vitepress-swiper';
import '@cssnr/vitepress-swiper/style.css';

// 公開先がサブディレクトリでも、プラグインへ渡す画像URLが正しく解決されるようにする。
// 実際のスクリーンショットが用意できたら、この一覧の画像を差し替える。
const slides = [
	'/images/home/slide0.png',
	'/images/home/slide1.png',
	'/images/home/slide2.png',
	'/images/home/slide3.png',
].map(imagePath => withBase(imagePath));
</script>

<template>
	<section class="home-slideshow">
		<div class="container">
			<VPSwiper
				:slides="slides"
				:autoplay="{ delay: 4000, pauseOnMouseEnter: true, disableOnInteraction: false }"
				:mousewheel="false"
				:pagination="{ clickable: true }"
				:no-fullscreen="true"
				border-radius="16px"
				height="100%"
			/>
		</div>
	</section>
</template>

<style scoped>
.home-slideshow {
	padding: 0 24px;
	margin-bottom: 64px;
}

.container {
	max-width: 1152px;
	margin: 0 auto;
	aspect-ratio: 2 / 1;
}

.container :deep(.vp-swiper-wrapper) {
	height: 100%;
}

.container :deep(.swiper) {
	--swiper-navigation-color: #ff9d33;
	--swiper-pagination-color: #ff9d33;
	--swiper-navigation-size: 28px;
	--swiper-navigation-sides-offset: 12px;
}

.container :deep(.swiper-slide img) {
	width: 100%;
}

@media (min-width: 640px) {
	.home-slideshow {
		padding: 0 48px;
	}
}

@media (min-width: 960px) {
	.home-slideshow {
		padding: 0 64px;
	}
}
</style>
