# Visual Module

画像処理用の、ノードを組み合わせてカプセル化したものを「Visual Module」と呼びます。

Visual Moduleは、In/Outノードを含むほか、外部に対するパラメータ定義(Custom Parameter)も行えるので、タイムライン上でレイヤーとして使用可能です。

Custom Parameterは、`canNode: true` ならInノード経由で配線し、`canNode: false` ならVisual Module内のノードのパラメータに直接アサインしたり、expression上からPARAM関数を通じて参照したりできます。

Visual Module内で別のVisual Moduleを通常のエフェクトのように使用するなど、再帰的な使用も将来実装予定です。

レイヤーとして使う場合、下のレイヤーまでの合成結果がInノードの出力になります。Outノードの出力は、タイムライン側でレイヤーのtransform・opacity・合成方法を適用してから、上のレイヤーへの入力になります。

## Visual Moduleファイル

- `.gsvm`はMessagePackで、種別・形式バージョン・Glitch Studioバージョン・表示名・`VisualModule`本体・依存するAsset原本・Player定義を保存する。プロジェクト内のVisual Module IDやAssetの元ファイルパス、LIVEの引数、配置先レイヤーの設定・実行時の再生状態は含めない。
- `glitch-studio/ui/src/gsvm.ts`が依存収集・エンコード／デコード・取り込み準備を担当する。Asset／Playerの収集はGlitch Studioの責務とし、Visual Module subsystemは所属プロジェクトを知らない。
- 依存収集はエフェクトのパラメータ定義に従って配列・構造体内のBindingをたどり、公開パラメータの既定値と要素追加・リセット用の設定の既定値も調べる。動的なAsset／Player参照は列挙できないため拒否する。素材の原本は`Blob`から`Uint8Array`へ変換して保存する。
- 取り込み時はVisual Module・Asset・Playerに新しいプロジェクト内IDを生成し、素材・Playerの参照を書き換える。内部のノード・公開パラメータ・出力・Automation GraphのIDは、そのVisual Module内のスコープなので維持する。
- ファイル由来のPlayerは素材IDを付け替える。カメラ・マイク・ライブストリーム由来のPlayerは参照を保ったまま入力未指定に戻し、再指定が必要な名前をUIへ返す。現在のPlayer UIが再指定できる外部入力はWebcamだけ。
- `importVisualModule` Commandが準備済みのVisual Module・Asset・Playerを一括追加する。Undo/Redoの通知で`visualModuleRegistration`の追加・削除をLIVEとTimelineの両レンダラーへ同期する。LIVE中のVisual ModuleをUndoで除去した場合はTimeline表示へ戻す。

## ノードの解像度

- ノードの解像度設定は `auto` / `context` / `customAbsolute` です。contextはLIVEではプロジェクト、タイムラインではそのノードが所属するSceneの解像度です。autoは素材・入力の寸法を優先し、それらがなければcontextへフォールバックします。ノードにprojectモードはありません。
- Visual Module内の式の `WIDTH` / `HEIGHT` は倍率適用後のcontext解像度です。個々のノード出力の寸法ではありません。呼び出し側が寸法を渡し、Visual Module側はSceneやプロジェクトの定義を参照しません。
