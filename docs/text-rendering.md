# テキストの組み方向

TextエフェクトとTextレイヤーのWriting Modeで、Horizontal（横書き）またはVertical (right to left)（縦書き）を選択する。既定値は横書き。縦書きでは上から下へ文字を送り、改行すると右から左へ次の列を配置する。

- 日本語・全角英数字・絵文字などは正立させる。半角英数字の連続部分は一つのまとまりとして横倒しにし、カーニングや合字を維持する。
- 結合文字・異体字セレクタ・連結された絵文字は書記素単位で扱い、一文字の途中で別の枠へ送らない。
- 括弧や長音符はUnicodeの文字方向に従って回転する。句読点「、。，．」は元のフォントの字形を枠の右上へ寄せる。
- AlignmentのLeft / Top・Center・Right / Bottomは、横書きでは左・中央・右揃え、縦書きでは上・中央・下揃えになる。Positionは列全体の左右の中央と、指定した整列の基準点を表す。
- Line / Column Spacingは横書きでは行間、縦書きでは列間隔を指定する。いずれも有効フォントサイズに対する比率。

横書きではMax Width（出力幅比）、縦書きではMax Height（出力高さ比）をOverflowの制限値として使う。Do Nothingではこの制限を無視する。Shrink Font Sizeでは輪郭と行／列間隔も含めてフォントサイズを縮め、Compress Along Writing Directionでは横書きの横方向・縦書きの縦方向だけを圧縮する。自動改行は行わない。

輪郭と影は同じ文字配置に追従する。影の移動量は組み方向によって回転せず、画面の右が+X、上が+Yのまま。TextエフェクトのSize Referenceはフォントサイズの換算に使い、最大幅／最大高さの軸は変えない。TextレイヤーのサイズはScene長辺比。

文字方向は[Unicode 17.0.0のVertical_Orientation](https://www.unicode.org/Public/17.0.0/ucd/VerticalOrientation.txt)に基づく。Canvasの横組み用字形を配置・回転する方式のため、フォント内のOpenType `vert` / `vrt2`による縦組み専用字形への置換や、縦中横・ルビ・禁則処理には対応しない。
