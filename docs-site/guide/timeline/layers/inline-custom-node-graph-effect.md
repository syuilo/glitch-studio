---
description: タイムラインのレイヤー内にCustom Node Graph Effectを作り、その場でノードを組み合わせて映像を生成・加工する方法を説明します。
---

# Custom Node Graph Effectレイヤー（インライン）

インラインCustom Node Graph Effectレイヤーは、そのレイヤー専用の[Custom Node Graph Effect](../../custom-node-graph-effect.md)を持ちます。一か所だけで使う加工や、複数のエフェクトを試しながら組む処理に向いています。

プロジェクト内の登録済みCustom Node Graph Effectを使う場合は、[参照方式](./custom-node-graph-effect.md)を選びます。

## 追加して編集する

1. **Add Layer → Custom Node Graph Effect (Inline)** を選びます。
2. レイヤーの詳細にある **Custom Node Graph Effect** を開きます。
3. **Nodes → Add Effect Node...** からエフェクトを追加します。
4. 各ノードの入力と、最後のOutへの接続を確認します。
5. クリップで処理を有効にする期間を決めます。

初期状態には主画像入力のInと主出力のOutがあり、両者は未接続です。下層の画像が自動でそのまま出力される構成ではありません。生成するノードをOutへ繋ぐか、Inから加工するノードを経由してOutへ繋ぎます。

## 下層の映像を加工する

例えば、下層の映像へ複数の処理をかける場合は、次の流れを作ります。

```text
Inの主画像入力 → 加工ノードA → 加工ノードB → Outの主出力
```

Inの主画像入力は、このレイヤーより下の合成映像です。構成が背景込みの完成映像を返す場合は、**Compositing → Blend mode** を置き換え（`replace`）にします。初期値は通常合成なので、自分で切り替えてください。

透明背景の図柄だけを生成して重ねる構成なら、通常合成（`normal`）を使います。合成方法を変えても、Inから下層を参照できること自体は変わりません。

## 外から調整する項目を作る

**Input Defs** で公開パラメータを定義し、内部ノードから参照すると、レイヤーの **Custom Node Graph Effect Parameters** で操作できます。例えば加工の強さを公開すれば、内部の複数のノードを一つの値で制御できます。

Custom Node Graph Effect Parametersに付ける式やキーはシーン時刻で動きます。一方、内部ノードのTIMEはクリップの内容時刻です。[パラメータの時間と参照範囲](../../parameters.md#time-and-scope)を確認してください。

## クリップと定義の関係

ノード構成と公開パラメータの設定は、そのレイヤーのすべてのクリップで共有します。別々の構成を使いたい場合は、インラインCustom Node Graph Effectレイヤーを分けてください。

各クリップの処理状態は独立しており、区間外では処理されません。履歴を使うエフェクトの状態を、離れたクリップ間で引き継ぐ使い方には向きません。

この方式の内部編集は、ほかのレイヤーで参照している登録済みCustom Node Graph Effectには影響しません。共通の構成を複数か所へ反映したいときは、[参照方式](./custom-node-graph-effect.md)を使います。
