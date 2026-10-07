# ユーザー向けドキュメントサイト

`docs/` はリポジトリの設計・仕様など、開発者向けの資料を置く場所です。公開するユーザーガイドは `docs-site/` に分離し、pnpmワークスペースの `@gs/docs-site` として管理します。

## 構成

```text
docs-site/
  .vitepress/
    config.ts        # サイト・ナビゲーション・検索・公開パスの設定
    theme/
      index.ts       # 標準テーマの拡張
      style.css      # ブランドカラーなどの上書き
  guide/             # ユーザー向けの記事
  public/gs.svg      # サイトロゴ・favicon
  index.md           # ホーム
  package.json
```

VitePress 1.6.4（導入時のnpm `latest`）の `pnpm exec vitepress init` で、Default Theme + CustomizationとTypeScriptを選んだscaffoldがベースです。生成されたMarkdown/APIの例は、Glitch Studioのユーザーガイドに置き換えています。

`public/gs.svg` はアプリの `packages/glitch-studio/ui/public/gs.svg` をコピーしたものです。ブランドロゴを変更したときは、こちらも更新してください。

## 開発

リポジトリのルートで実行します。

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

ターミナルに表示されるURLの `/glitch-studio/docs/` を開きます。ドキュメントだけを開発する場合、アプリ本体の起動は不要です。

本番ビルドとプレビューは次のコマンドで行います。

```sh
pnpm docs:build
pnpm docs:preview
```

設定・テーマの型チェックとlintは `pnpm --dir docs-site lint` で実行できます。ルートの `pnpm lint` にも含まれます。

成果物は `docs-site/.vitepress/dist/`、キャッシュは `docs-site/.vitepress/cache/` に生成されます。どちらもGitの管理対象外です。

## 記事を追加する

1. `docs-site/guide/` にMarkdownファイルを追加します。先頭の見出しを記事タイトルにし、frontmatterの `description` に概要を記載します。
2. `.vitepress/config.ts` の `themeConfig.sidebar` に記事へのリンクを追加します。
3. `pnpm docs:build` でビルドし、`pnpm docs:preview` で表示とリンクを確認します。ビルドでは記事内のリンク切れも検出します。

記事同士のリンクには `./timeline.md` などの相対パスを使えます。ナビゲーションの `/guide/timeline` や画像の `/gs.svg` には、VitePressが公開用の `base` を付けます。`head` 内のfaviconのURLは自動補完されないため、設定ファイル内の `base` を明示的に使用しています。

ローカル検索・ライト/ダークモードは標準テーマの機能です。`appearance: 'dark'` により、表示テーマが未選択の初回はダークモードになります。ユーザーが切り替えたテーマは次回以降も保持されます。検索に外部サービスのアカウントやAPIキーは必要ありません。テーマカラーは `#ff8400` とし、ライトモードの本文リンクには読みやすい濃色を使います。

## GitHub Pagesへの公開

既存の `.github/workflows/deploy.yml` で、`master` へのpush時または手動実行時に公開します。リポジトリの **Settings → Pages → Build and deployment → Source** は **GitHub Actions** を使用します。

1. `pnpm build` でアプリをビルドします。
2. `pnpm docs:build` でドキュメントをビルドします。
3. ドキュメントの成果物を、アプリの成果物の `docs/` 配下にコピーします。
4. アプリとドキュメントを一つのPages artifactとしてデプロイします。

| 内容 | 公開URL |
| --- | --- |
| アプリ | `https://syuilo.github.io/glitch-studio/` |
| ユーザーガイド | `https://syuilo.github.io/glitch-studio/docs/` |

ドキュメントの `base` は `/glitch-studio/docs/` です。GitHub Pagesで記事へ直接アクセスできるよう、`cleanUrls` はfalseにしています。公開URLを変更するときは、`base` と、アプリへのリンク・READMEの公開URLも見直してください。

Pagesへのデプロイはサイト全体を置き換えるため、ドキュメントだけを別のworkflowから同じサイトへデプロイしないでください。PRのTest workflowでもドキュメントをビルドして、公開前にビルドエラーを検出します。
