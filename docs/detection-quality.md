# 回帰検証と検出品質の評価

## アプリの回帰検証

`npm test`は既存の23候補・支持関係の合成データと追加の一連のCLIテストで、
棚下段の本、中段の家電、テレビ台とテレビ、壁の時計、ラックの一体・別体、
低confidence、未配置、旧形式、不正な関係、未知寸法、親削除、再取り込み、
根拠の保存復元、HTML出力を確認します。
`test/detail-roundtrip.test.js`は取り込み→確認済み補正→再取り込み→
不正変更の拒否→保存復元→HTMLと検証結果の一致をまとめて確認します。
`scripts/package-check.js`も本番依存だけのインストールで支持面と子を復元します。

`npm run lint`、`npm test`、`npm run demo`、`npm run test:browser`、
`npm run test:package`を順に実行します。ブラウザ確認はGoogle Chromeの
file://・offlineで、選択・階層・配置・画像枠・小画面を確認します。
これらはアプリの保存・描画を確認し、画像モデルの精度を証明しません。

## 独立した正解画像とJev実測

`test/fixtures/quality-room.svg`から生成したPNGと、対象なしのPNGを同梱します。
素材は自作のCC0合成図です（quality-LICENSE.txt）。個人写真は含みません。
棚内の小物、別体のラック、同種2個の時計、画像端の時計を含めています。
正解は作図座標から定義し、PNGと目視照合しました。棚の背板で奥行きが隠れる
ような実写真の遮蔽を代表する素材ではなく、衣類は評価対象外の装飾です。

2026-10-25にjev-1.14.0へ2画像でカテゴリ探索各1回、8対象の有無とBox各1回の
合計4リクエストを送りました。候補表は24カテゴリ、Boxの対象は
quality-targets.jsonの6対象と不在の机・ソファです。閾値は変更していません。
検出率はこの固定対象の条件付き評価で、自由な物体列挙や種類分類の評価ではありません。

presence 0.8以上かつkindがnoneでない回答を採用し、画像ID・カテゴリが同じ枠を
confidence順の一対一で対応付けます。正解とIoU 0.5以上ならTP、未対応予測はFP、
未対応正解はFNとします。重複予測はFP、種類違いはFPとFNの両方になります。
平均IoUは一致枠だけの平均です。予測ゼロの適合率と正解ゼロの再現率はnullです。

| 指標 | 結果 |
| --- | --- |
| TP / FP / FN | 5 / 0 / 1 |
| 適合率 | 1.000 |
| 再現率 | 0.833 |
| 一致した5枠の平均IoU | 0.869 |
| 対象なし画像の採用予測 | 0 |

家電は探索の候補に挙がりましたが、個別の有無判定で採用閾値に達しませんでした。
精度改善の比較実験ではなく、小さい合成図の測定です。実写真・複雑な遮蔽への
一般化や、以前より精度が上がったという結論には使えません。
大きな独立画像集合と事前固定したラベル・閾値で追加評価が必要です。

4回のusage合計は入力17,241・出力3,973トークンです。リクエスト・原回答・
採否前の全Box・画像ハッシュ・usage・評価結果をquality-results/へ保存しています。
APIキーと画像のbase64はリクエストJSONに含みません。素材PNGは別に同梱します。

保存回答の再集計にはAPIもPythonも不要です。

```sh
node scripts/detection-quality.js test/fixtures/quality-labels.json test/fixtures/quality-results/predictions.json
node scripts/generate-quality-fixtures.js
```

新しい実測では元の結果を上書きせず、別ディレクトリへ回答を残してください。
元リクエストはmultipartのphotoパートへ同じPNGを付けて再送できます。
認証・画像APIの形式は[公式Images](https://docs.typesafe.ai/images)と
[Box](https://docs.typesafe.ai/primitives/box)を参照してください。
通常テストは外部APIを呼びません。API再実行は新しい結果として別に評価します。

## スキルの確認

ローカルjev-room-importのオフラインテスト14件は成功しました。
同スキルのread_imageはPillow 12.3でPNGのEXIF確認後のverifyが失敗したため、
実測用コピーだけで次のように同じbytesを開き直して検証しました。
元スキルはこのリポジトリで追跡されていないため、本PRでは変更していません。

```python
with Image.open(io.BytesIO(data)) as verifier:
  verifier.verify()
```

コピーを`output/quality-runtime/`へ置き、discover_objects.py→画像との目視照合→
analyze_room.pyの順に実行しました。生成物を同じoutputパスに置いた場合は
`node scripts/summarize-quality-run.js`で保存回答を再構成できます。
スキルに依存しない再送には同梱リクエストを利用してください。

## 物体数・容量・画像重複の測定

`node scripts/detail-benchmark.js`は10・100・500物体を生成し、HTML出力時間、
Chrome offlineでmeshCountに到達する時間、容量、画像埋め込み回数を計測します。
同じ画像を全物体が共有する負荷です。実際のFPS・GPU上の表示完了ではありません。

| 物体数 | 出力時間 ms | 表示初期化 ms | HTML bytes | 画像コピー数 |
| --- | --- | --- | --- | --- |
| 10 | 13 | 535 | 745,065 | 10 |
| 100 | 27 | 439 | 2,234,033 | 100 |
| 500 | 108 | 1,063 | 8,867,338 | 500 |

Windows / Node.js 22.12.0 / Google Chrome、2026-10-25、一回の測定です。
時間のばらつきとキャッシュの影響があり、性能保証や厳密な比較ではありません。
画像一覧は同一画像をまとめますが、埋め込みJSON内の同じ画像は重複しています。
この測定は制約を可視化するもので、重複削減を実装したものではありません。
