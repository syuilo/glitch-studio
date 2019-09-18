# Glitch Studio

![Glitch Studio](./screenshots/glitch-studio.jpg)

## About
Glitch Studioはグリッチエフェクト(画像が壊れたような効果)に特化した画像加工ワークステーションソフトウェアです。ソースとなる画像データに対して様々なエフェクトを適用していくことで、簡単に画像に複雑なグリッチ効果を与えることができます。
例えばチャンネルシフトFXで画像の個々のシグナルを分離してフリンジを付加したり、各種のブロックノイズジェネレーターで意図的なピクセルエラーを発生させたり、スキャンラインをずらすことによりスクリーンのティアリングを再現できます。内蔵されているエフェクトはそれぞれ複数のパラメータを持ち、細部まで動作をカスタマイズ可能です(お望みならAfterEffectsのようなエクスプレッションやマクロをアサインすることもできます)。
しかも、それらのエフェクトは無制限にカスケード可能で組み合わせも自由なので、ほぼ無限のバリエーションのユニークなグリッチ効果を作成できます。
ランダマイズ機能を使えば、予測不能なアーティファクトを生み出してデザインのインスピレーションを得るのにも役立ちます。

* エフェクトにはランダムな効果を与えるものもありますが、乱数のシードもパラメータとして与えられるので、実行するたびに結果が変わってしまう心配はありません。
* お気に入りのエフェクトが完成したら、プリセットに保存していつでも呼び出せるようにできます。プリセットはエクスポート可能なので、他の人とシェアすることもできます。
* 全ての処理は無劣化で行われ、元の品質を保ったままレンダリングできます(ファイルデータ自体を実際に破壊する方法ではないため、他の環境でも正確に表示できます)。
* アルファチャンネルに対応しているので、透過PNGなどの画像も透過部分を保ったままグリッチさせられます。

### エフェクトの例
Glitch Studioには専用に設計された様々なエフェクトが組み込まれています。その中から、作者のお気に入りをいくつか紹介します:

* **チャンネルシフト** ... 任意のチャンネルを分離し、それらをずらして重ね合わせ、色収差やフリンジのような効果を再現します。
* **ピクセルブラー** ... 個々のピクセルが連続して上書きされたようなブラー効果を与えます。
* **ブロックノイズ** ... ブロック状にデータが欠落したような効果を様々なブレンドモードで適用します。
* **ティアリング** ... ティアリングと呼ばれる画像の乱れをシミュレートします。「グリッチといえばこのエフェクト」と言っていいほど、使用頻度の高いエフェクトです。
* **グラニュラー** ... 画像を粒子状に細かく切り刻み再配置します。元々は音に対して使われる処理ですが、画像にも同じことをしました。

## ダウンロード
Coming soon

## 使い方
### エフェクト
エフェクトを使用することで、画像に様々な効果を付加することができます。エフェクトを追加するには、「FX」タブの「Add FX...」をクリックします。利用可能なエフェクト一覧が表示されるので、好きなエフェクトを選択して追加できます。
追加されたエフェクトはエフェクトラックに表示され、並べ替えたりパラメータを操作したりできます。
エフェクトは上から下の順で適用されます。

#### パラメータ
エフェクトはパラメータを持っており、パラメータを操作することでエフェクトの動作を調整できます。
エフェクトラック内の各エフェクトには、パラメータ名とパラメータコントロールの組みが一覧になって表示されます。
パラメータコントロールはパラメータの種類によって異なりますが、数値を入力したりフラグのオンオフを切り替えたりできます。

#### 有効/無効切り替え
エフェクトコントロールの上部にある目のアイコンをクリックすると、エフェクトの有効化状態を切り替えられます。エフェクトを無効にすると、その間はエフェクトの適用がスキップされ、一時的にエフェクトの無い状態を確認できます。

### エクスプレッション
エクスプレッションを使うとエフェクトのパラメータを動的に算出させることができます。エクスプレッションの有効/無効を切り替えるには、パラメータのラベル部分をダブルクリックします。エクスプレッションが有効になっているパラメータは色付きでハイライトされ、通常のコントロールの代わりにエクスプレッションエディタが表示されます。
エクスプレッションエディタに式を入力すると、その式の評価結果がパラメータとして渡されます。

#### 変数
式の中には変数を含めることもできます。利用可能な変数:

* `WIDTH` ... 画像の幅(px)
* `HEIGHT` ... 画像の高さ(px)

これらに加え、後述するマクロも変数として参照できます。

#### 関数
式の中では、いくつかの数学的関数が使用可能です。

Glitch Studioでは式の評価に[Math.js](https://mathjs.org/)を使用しているため、詳しい情報については[ドキュメント](https://mathjs.org/docs/reference/functions.html)をご覧ください(`math.`のプレフィックスは不要)。

### マクロ
マクロを使うと、独自のコントロールを作成し、その値をエクスプレッション内で変数として参照することができます。
複数のエフェクトのパラメータを一括して操作するときに便利です。また、マクロもプリセットに含められるため、プリセット使用者に対してオプションを提供する用途にも利用できます。
マクロにもエクスプレッションを使えますが、循環参照を防ぐためマクロ内でマクロを変数として参照することはできません。

#### マクロの操作と追加
「Macro」タブに切り替えると、マクロ操作パネルとマクロ管理パネルが表示されます。
マクロ操作パネルでマクロの値を操作できます。マクロ管理パネルでは、マクロの追加/削除や設定の変更を行えます。

#### マクロの設定
* **Label** ... マクロが表示されるときの名前
* **Name** ... 変数名。ここで設定した名前で、エクスプレッション内で参照できます。
* **Type** ... マクロの種類。数値やフラグなどがあります。

### プリセット
プリセット機能を使うと、お気に入りのエフェクトの組み合わせを保存して、いつでも呼び出せるようにできます。

#### プリセットのエクスポート
作ったプリセットを他の人に使ってもらいたいときに便利です。

#### プリセットのインポート
他の人が作ったプリセットを保存することができます。

## ライセンス
Glitch Studioはオープンソースであり、MITライセンスの下で公開されています。
