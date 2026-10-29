# Visual Module

画像処理用の、ノードを組み合わせてカプセル化したものを「Visual Module」と呼びます。

Visual Moduleは、In/Outノードを含むほか、外部に対するパラメータ定義(Custom Parameter)も行えるので、タイムライン上でレイヤーとして使用可能です。

Custom Parameterは、`canNode: true` ならInノード経由で配線し、`canNode: false` ならVisual Module内のノードのパラメータに直接アサインしたり、expression上からPARAM関数を通じて参照したりできます。

Visual Module内で別のVisual Moduleを通常のエフェクトのように使用するなど、再帰的な使用も将来実装予定です。

Visual Module内の式では、`POINTER_POSITION`でポインタ位置を2要素の配列`[x, y]`として参照できます。位置パラメータの式にそのまま指定でき、成分は`POINTER_POSITION[0]`（X）・`POINTER_POSITION[1]`（Y）で取得できます。入力元を「環境変数」に切り替え、「ポインタ位置 (POINTER_POSITION)」を選ぶことでも直接指定できます。座標はプレビューの画像領域を基準に、中央が`[0, 0]`、左下が`[-1, -1]`、右上が`[1, 1]`です。Visual Module Live Previewではプレビュー領域内のポインタ移動に追従し、画像の外側では`-1`〜`1`を超える値も取ります。プレビュー領域を離れると最後の位置を保持します。Timeline内のVisual Moduleでは、既存のポインタ未指定値`[-99999, -99999]`になります。TimelineレイヤーやVisual Module Live PreviewのCustom Parameterを設定する式には公開しません。

レイヤーとして使う場合、下のレイヤーまでの合成結果がInノードの出力になります。Outノードの出力は、タイムライン側でレイヤーのtransform・opacity・合成方法を適用してから、上のレイヤーへの入力になります。

## Visual Moduleファイル

- `.gsvm`はMessagePackで、種別・形式バージョン・Glitch Studioバージョン・表示名・`VisualModule`本体・依存するAsset原本・Player定義を保存する。プロジェクト内のVisual Module IDやAssetの元ファイルパス、Visual Module Live Previewの引数、配置先レイヤーの設定・実行時の再生状態は含めない。
- `glitch-studio/ui/src/gsvm.ts`が依存収集・エンコード／デコード・取り込み準備を担当する。Asset／Playerの収集はGlitch Studioの責務とし、Visual Module subsystemは所属プロジェクトを知らない。
- 依存収集はエフェクトのパラメータ定義に従って配列・構造体内のBindingをたどり、公開パラメータの既定値と要素追加・リセット用の設定の既定値も調べる。動的なAsset／Player参照は列挙できないため拒否する。素材参照に加工式が付いている場合も、無効化中や基準値が未選択の場合を含め、書き出し・取り込みを拒否する。コード内のIDは再割り当てできないため、加工式を削除し、固定値またはCustom Parameter経由で指定する。素材の原本は`Blob`から`Uint8Array`へ変換して保存する。
- 取り込み時はVisual Module・Asset・Playerに新しいプロジェクト内IDを生成し、素材・Playerの参照を書き換える。内部のノード・公開パラメータ・出力・Automation GraphのIDは、そのVisual Module内のスコープなので維持する。
- ファイル由来のPlayerは素材IDを付け替える。カメラ・マイク・ライブストリーム由来のPlayerは参照を保ったまま入力未指定に戻し、再指定が必要な名前をUIへ返す。現在のPlayer UIが再指定できる外部入力はWebcamだけ。
- `importVisualModule` Commandが準備済みのVisual Module・Asset・Playerを一括追加する。Undo/Redoの通知で`visualModuleRegistration`の追加・削除をVisual Module Live PreviewとTimelineの両レンダラーへ同期する。Visual Module Live Preview中のVisual ModuleをUndoで除去した場合はTimeline表示へ戻す。

## ノードの解像度

- ノードの解像度設定は `auto` / `context` / `customAbsolute` です。contextはVisual Module Live Previewではプロジェクト、タイムラインではそのノードが所属するSceneの解像度です。autoは素材・入力の寸法を優先し、それらがなければcontextへフォールバックします。ノードにprojectモードはありません。
- Visual Module内の式の `WIDTH` / `HEIGHT` は倍率適用後のcontext解像度です。個々のノード出力の寸法ではありません。呼び出し側が寸法を渡し、Visual Module側はSceneやプロジェクトの定義を参照しません。
