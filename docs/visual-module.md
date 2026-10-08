# Visual Module

画像処理用の、ノードを組み合わせてカプセル化したものを「Visual Module」と呼びます。

Visual Moduleは、In/Outノードを含むほか、外部に対するパラメータ定義(Custom Parameter)も行えるので、タイムライン上でレイヤーとして使用可能です。

Custom Parameterは、`canNode: true` ならInノード経由で配線し、`canNode: false` ならVisual Module内のノードのパラメータに直接アサインしたり、expression上からPARAM関数を通じて参照したりできます。

Visual Module内で別のVisual Moduleを通常のエフェクトのように使用するなど、再帰的な使用も将来実装予定です。

レイヤーとして使う場合、下のレイヤーまでの合成結果がInノードの出力になります。Outノードの出力は、タイムライン側でレイヤーのtransform・opacity・合成方法を適用してから、上のレイヤーへの入力になります。

## ノードの解像度

- ノードの解像度設定は `auto` / `context` / `customAbsolute` です。contextはLIVEではプロジェクト、タイムラインではそのノードが所属するSceneの解像度です。autoは素材・入力の寸法を優先し、それらがなければcontextへフォールバックします。ノードにprojectモードはありません。
- Visual Module内の式の `WIDTH` / `HEIGHT` は倍率適用後のcontext解像度です。個々のノード出力の寸法ではありません。呼び出し側が寸法を渡し、Visual Module側はSceneやプロジェクトの定義を参照しません。
