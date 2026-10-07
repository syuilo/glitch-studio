import { defineConfig } from 'vitepress';

// アプリ本体と同じGitHub Pagesサイトの、docs配下に公開する。
const base = '/glitch-studio/docs/';

export default defineConfig({
	lang: 'ja-JP',
	title: 'Glitch Studio',
	titleTemplate: ':title | Glitch Studio Docs',
	description: 'フリーの画像・動画編集ソフト、Glitch Studioのユーザーガイド',
	base,
	appearance: 'dark',
	cleanUrls: true,
	head: [
		['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}gs.svg` }],
		['meta', { name: 'theme-color', content: '#ff8400' }],
	],
	themeConfig: {
		logo: { src: '/gs.svg', alt: 'Glitch Studio' },
		siteTitle: 'Glitch Studio Docs',
		nav: [
			{ text: 'ガイド', link: '/guide/getting-started', activeMatch: '/guide/' },
			{ text: 'ダウンロード', link: '/guide/download' },
			{ text: 'Web版', link: 'https://syuilo.github.io/glitch-studio/' },
			{ text: 'リリースノート', link: '/guide/release-notes' },
		],
		sidebar: [
			{
				text: 'User Guide',
				items: [
					{ text: 'Glitch Studioとは？', link: '/guide/getting-started' },
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
