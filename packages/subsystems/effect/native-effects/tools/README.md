# Native Effect のサムネイル

`_def_.ts` の `thumbnail` で、エフェクトピッカーに表示する画像の用意方法を指定します。

| `mode` | 動作 |
| --- | --- |
| `none` または `thumbnail` の省略 | 画像を表示しない |
| `static` | `_def_.ts` と同じディレクトリに手動で用意した `thumbnail.webp` を表示 |
| `defaultParameters` | パラメータの既定値で描画 |
| `customParameters` | `params` で指定した値を既定値に上書きして描画 |

自動生成は `color` の主出力を時刻 0 で描画し、黒背景に合成した 300 × 200 px の不透明な非可逆 WebP を品質 `0.85` で作ります。`inputs` を省略すると `color` の主入力に `sceneA` を繋ぎます。`inputs` を指定すると列挙した入力だけに繋ぎ、空のオブジェクトなら画像接続なしで描画します。画像が指定された入力では接続が優先されます。

```ts
thumbnail: {
	mode: 'customParameters',
	inputs: { inputA: 'sceneA', inputB: 'sceneB' },
	params: { progress: 0.5 },
},
```

リポジトリルートで実行します。コマンドは Chrome を標準のインストール先と `PATH` から探します。別の場所にインストールした Chrome を使う場合は、`CHROME_PATH` に実行ファイルのパスを指定できます。

```text
pnpm generate:effect-thumbnails
pnpm generate:effect-thumbnails --effect slideTransition
```

コマンドは自動生成対象のディレクトリに `thumbnail.webp` を保存します。画像を確認して Git に追加してください。
