リポジトリ全体で共通の型や処理などを置く

横着してなんでもかんでもこの層に置くのではなく、本当にどのドメインにも属さず共有する必要があるものだけ置くこと。

あまり肥大化させないのが望ましい

Glitch Studioドメイン内だけで共有する必要のあるものは、ここではなく`glitch-studio/shared`に置くべし。

## GPU共通基盤

`src/gpu`には、Effect・Visual Module・Timelineやプロジェクトを知らずに使えるGPUデータ表現と処理を置く。

- `uniform-or-texture.ts`: 空間的に一定の値、またはテクスチャを表す`UniformOrTexture`。生成元や接続先の情報、サンプリング設定は持たない。
- `shader-input.ts`: `UniformOrTexture`と受け取り側のサンプリング設定から`ShaderInput`を作る`toShaderInput()`、およびWGSLの読み取り関数とbindingの生成。
- `shader-input-pipeline.ts`: シェーダー入力の構成に応じたpipelineとbindingの管理。
- `uniform-or-texture-to-texture-resolver.ts`: `GPUTexture`が必要な境界で定数だけをテクスチャ化する`UniformOrTextureToTextureResolver`。借用テクスチャの所有権は持たず、自身が作った定数テクスチャだけを管理する。

色はpremultiply済みのまま受け渡し、変換時に再乗算しない。定数をいつテクスチャ化するかとresolverの寿命は呼び出し側が決める。ノードの接続解決、Effectの出力管理、Sceneの画面サイズ確定は、それぞれのドメインが担当する。
