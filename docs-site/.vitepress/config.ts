import { defineConfig } from 'vitepress';

// アプリ本体と同じGitHub Pagesサイトの、docs配下に公開する。
const base = '/glitch-studio/docs/';

export default defineConfig({
	lang: 'ja-JP',
	title: 'Glitch Studio',
	titleTemplate: ':title | Glitch Studio',
	description: 'フリーの画像・動画編集ソフト、Glitch Studioのユーザーガイド',
	base,
	appearance: 'dark',
	cleanUrls: true,
	head: [
		['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}gs.svg` }],
		['meta', { name: 'theme-color', content: '#ff8400' }],
	],
	themeConfig: {
		logo: { src: '/gs.svg', alt: '' },
		siteTitle: 'Glitch Studio',
		nav: [
			{ text: 'ガイド', link: '/guide/getting-started', activeMatch: '/guide/' },
			{ text: 'ダウンロード', link: '/guide/download' },
			{ text: 'Web版', link: 'https://syuilo.dev/glitch-studio/' },
			{ text: 'リリースノート', link: '/guide/release-notes' },
		],
		sidebar: [
			{
				text: '基本ガイド',
				items: [
					{ text: 'Glitch Studioとは？', link: '/guide/getting-started' },
					{ text: 'タイムライン', link: '/guide/timeline' },
					{ text: 'Visual Module', link: '/guide/visual-module' },
					{ text: 'パラメータ', link: '/guide/parameters' },
				],
			},
			{
				text: 'レイヤー',
				items: [
					{ text: '画像', link: '/guide/timeline/layers/image' },
					{ text: '動画', link: '/guide/timeline/layers/video' },
					{ text: '音声', link: '/guide/timeline/layers/audio' },
					{ text: 'テキスト', link: '/guide/timeline/layers/text' },
					{ text: 'シェイプ', link: '/guide/timeline/layers/shape' },
					{ text: 'エフェクト', link: '/guide/timeline/layers/effect' },
					{ text: 'Visual Module（インライン）', link: '/guide/timeline/layers/inline-visual-module' },
					{ text: 'Visual Module（参照）', link: '/guide/timeline/layers/visual-module' },
					{ text: 'グループ', link: '/guide/timeline/layers/group' },
					{ text: 'シーン', link: '/guide/timeline/layers/scene' },
					{ text: 'VOICEVOX', link: '/guide/timeline/layers/voicevox' },
				],
			},
		],
		socialLinks: [
			{ icon: 'github', link: 'https://github.com/syuilo/glitch-studio' },
		],
		search: {
			provider: 'local',
			options: {
				locales: {
					root: {
						translations: {
							button: { buttonText: '検索', buttonAriaLabel: 'ドキュメントを検索' },
							modal: {
								displayDetails: '詳細を表示',
								resetButtonTitle: '検索をクリア',
								backButtonTitle: '検索を閉じる',
								noResultsText: '「{search}」に一致する記事はありません',
								footer: { selectText: '選択', navigateText: '移動', closeText: '閉じる' },
							},
						},
					},
				},
			},
		},
		outline: { label: 'このページの内容', level: [2, 3] },
		docFooter: { prev: '前の記事', next: '次の記事' },
		editLink: {
			pattern: 'https://github.com/syuilo/glitch-studio/edit/master/docs-site/:path',
			text: 'GitHubでこのページを編集',
		},
		returnToTopLabel: 'ページの先頭へ',
		sidebarMenuLabel: 'メニュー',
		skipToContentLabel: '本文へ移動',
		darkModeSwitchLabel: '表示テーマ',
		lightModeSwitchTitle: 'ライトモードに切り替え',
		darkModeSwitchTitle: 'ダークモードに切り替え',
		notFound: {
			title: 'ページが見つかりません',
			quote: 'ページが移動したか、URLが間違っている可能性があります。',
			linkLabel: 'ドキュメントのホームへ',
			linkText: 'ホームへ戻る',
		},
		footer: { message: 'Glitch Studio User Guide' },
	},
});
