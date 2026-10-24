# 検出データの取り込みと確認

画像解析は利用側で行い、本体はローカルJSONだけを読み込みます。
従来のroom/furniture/objectsのJSONへ任意の`analysis`を追加できます。
`schema --kind room|furniture|object`で契約を取得してください。
検出枠と実寸の3D座標は別々に記録します。

## 出典と検出枠

```json
{
  "sources": [{"id": "photo", "sha256": "元画像のバイト列のSHA-256（64桁の小文字hex）"}],
  "regions": [{"id": "crop", "imageId": "photo", "box": [0.1, 0.2, 0.3, 0.6]}],
  "detections": [{
    "id": "clock-detection",
    "imageId": "photo",
    "regionId": null,
    "box": [0.7, 0.1, 0.1, 0.1],
    "targetId": "clock",
    "model": "解析に使ったモデル名",
    "presenceProbability": 0.9,
    "boxConfidence": 0.6,
    "categoryConfidence": 0.8,
    "decision": "accepted",
    "reason": "時計の外周が見えるため採用"
  }]
}
```

これは解析JSONの`analysis`部分です。`sources[].sha256`の説明用文字列を
実際のハッシュに置き換え、room/furniture/objectsを併記します。
PowerShellでは`(Get-FileHash -Algorithm SHA256 -LiteralPath room.png).Hash.ToLower()`
で取得できます。画像は`--image`で指定してください。

Boxは左上原点の`[x,y,width,height]`を0〜1へ正規化します。
regionのBoxは原画像内、regionId付きの検出Boxはその切り抜き内の座標です。
原画像への変換は`x = region.x + box.x * region.width`、
`width = box.width * region.width`（y/heightも同様）です。
切り抜きの回転・透視変換は扱わず、軸に平行な切り抜きだけを扱います。

targetIdは本体の家具・小物・開口部等のIDです。物体のsourceIdを検出IDに
合わせる方法でも対応付けできます。画像上だけの候補はtargetIdをnullにします。
decisionはaccepted/pending/excluded。除外候補はtargetIdをnullにして理由を残し、
furniture/objectsには追加しません。pending候補には仮の3D物体を付けても構いません。
確率とconfidenceは0〜1またはnullです。実寸の確からしさを表しません。
生のモデル回答や補正理由はanalysis内の追加属性としても保持できます。

## 外部検出レポートの取り込み（互換入力）

通常の取り込みには、`schema --kind room`の契約に合わせた解析JSONを
`--analysis`で指定します。外部の解析ツールで得た検出結果を、以下の互換入力形式へ
整形して`--detections`に渡すこともできます。特定の解析ツールやモデルには依存しません。

`detections.json`の例です。sha256の説明用文字列を、元画像の実際のハッシュへ
置き換えてください。

```json
{
  "model": "external-detector",
  "sha256": "元画像のバイト列のSHA-256（64桁の小文字hex）",
  "targets": [{
    "id": "shelf",
    "name": "棚",
    "role": "furniture",
    "kind": "shelf",
    "included": true,
    "presence": 0.9,
    "box": {"left": 0.1, "top": 0.2, "right": 0.4, "bottom": 0.8},
    "box_confidence": 0.8,
    "kind_confidence": 0.8
  }]
}
```

- `model`は解析に使ったモデル名、`sha256`は`--image`で渡す原画像のハッシュです。
  モデル名は任意の識別子をそのまま保存し、解析元による処理の分岐は行いません。
- `targets[].id`は一意で安定した検出ID、`name`は候補名です。
  `role`は`furniture`・`object`・`opening`から指定します。
- `kind`は本体の簡易形状です。`included`で採否を指定し、任意の`reason`に理由を残せます。
  除外候補もレポートに残してください。
- この形式の`box`は左上原点のleft/top/right/bottomを0〜1に正規化します。
  上述の`analysis.detections[].box`の配列形式とは異なります。
- `presence`は有無の確率、`box_confidence`と`kind_confidence`は枠・種類のconfidenceです。
  不明な値はnullにし、実寸の確からしさとは分けます。
- 小物の親は任意の`parent_id`で、同じレポート内の採用対象のIDを参照します。
  検出枠から実寸や設置高さを自動補完しません。

切り抜きを使用した場合は、`input_box`に切り抜き内の枠、`box`に原画像へ戻した枠を
指定します。`input_transform.region`に原画像内の切り抜き範囲を
left/top/right/bottomで記録します。対象ごとに範囲が異なる場合は
`targets[].source_transform.region`を使用できます。変換と原画像の枠が一致しない入力は拒否します。

`--analysis`を併用すると、物体のID・sourceId・一意な候補名で対応付けます。
未配置の開口部と除外候補は画像上だけの候補に残します。
任意の原回答JSONは、`--response`で併せて保存できます。ファイル名は自由です。
原回答の形式は解析元に依存して構いません。本体はその内容を解釈せず、
検出レポートは`analysis.sourceReport`、原回答は`analysis.modelAnswer`に保持します。
各解析元の出力から共通の入力形式への整形は、利用側で行ってください。

```sh
node bin/oheya-kae.js room import --image room.png --analysis analysis.json --detections detections.json --response response.json
```

`--analysis`を省略すると、不明寸法の下書きから作成します。
本体は解析APIを呼び出しません。

旧データに`analysis.jevReport`がある場合は、その値を保持したまま
`analysis.sourceReport`としても読み込みます。既にsourceReportがあれば優先し、
新しい取り込みではsourceReportを使用します。

## 再取り込み

```sh
node bin/oheya-kae.js room import --image room.png --analysis analysis.json
node bin/oheya-kae.js room import --merge --image room.png --analysis revised.json
```

`--merge`は既存プロジェクトへ差分を反映します。検出IDの対応表、物体ID、
sourceIdの順で照合し、確認済みの属性・寸法・配置を保持します。
検出IDはプロジェクト内で安定し、一意になるよう利用側で指定してください。
照合できない物体は追加し、今回の結果にない既存物体は保持します。
家具と小物の所属は照合済み物体では維持します。従来の解析JSONでも安定した
id/sourceIdを使えば照合できます。単体のfurniture/object importも照合します。

保存するanalysis.rawは取り込んだ元のJSON、analysis.idMapは検出IDから本体IDへの
対応表です。採用値はroom/furniture/objectsに保存します。
各フィールドのevidence.historyに更新前の値・状態・根拠を残します。
再取り込み時もAI由来のconfirmedはestimatedへ下げ、確認済みへ昇格させません。
以前の検出・出典で今回の入力にないものも保持し、元の回答はanalysis.runsに残します。
同一の原回答は重複して追加しません。別の画像に同じsource IDや検出IDを再利用する
取り込みは拒否するため、別画像には別のIDを付けてください。
物体をCLIで削除した場合は、検出を未配置の画像候補に戻して出典を残します。
元画像はanalysis.imagesにも独立して保持し、唯一の所有物体を削除しても残します。
旧形式のプロジェクトは読み込み時に元画像をこの保存領域へ移します。
開口部も安定したIDで照合し、個別に確認した寸法・履歴と今回省略された開口部を保持します。

不正なBox、確率、親参照、検出参照、重複ID、画像ハッシュ不一致は保存前に拒否します。
metadataの全sourcesが今回の`--image`に含まれる必要があります。
失敗した取り込みでは既存プロジェクトファイルを保持します。

## 推定値の修正と実測の確認

```sh
node bin/oheya-kae.js furniture update --id shelf --width 1200 --status estimated --note "既知の本の幅との比率"
node bin/oheya-kae.js furniture move --id shelf --x 1500 --status estimated --note "配置プレビュー"
node bin/oheya-kae.js object update --id clock --y 1500 --status estimated --note "画像から仮置き"
node bin/oheya-kae.js furniture update --id shelf --width 1180 --status confirmed --note "メジャーで実測"
node bin/oheya-kae.js furniture update --id shelf --confirm width
```

room update、room opening update、furniture update/move、object updateで
`--status confirmed|estimated|image|unknown`を使えます。
既定はconfirmedです。confirmed以外では`--note`が必要で、`--confirm`との併用は拒否します。
寸法のnullはunknownのままです。unknown状態に数値を持たせて仮表示することもできます。
履歴は元のunknown/null、モデル値、仮値、人の確認・再修正を区別します。
本体による一律の寸法補完は行いません。

## ビューアー

「拡大・検出枠を確認」から元画像と枠を開けます。枠はTabとEnterでも選択できます。
選択は一覧・詳細・3Dと連動し、棚の詳細には内容物へのボタンが出ます。
家具・小物・開口部・画像上だけの候補を切り替えられ、寸法不明でも一覧に残ります。
子の寸法ラベルは親か子を選んだときに表示し、重なるラベルを抑制します。

面積・寸法ラベル・一覧の未確認寸法には「仮」を付けます。
確認項目は物体ごとの仮寸法・配置と属性にまとめ、幾何の問題は配置チェックに、
pendingまたは有無/枠/種類の値が0.6未満の候補は「検出の曖昧さ」に表示します。
これは表示上の確認目安で、検出精度を評価した閾値ではありません。
検出数は除外候補を含み、3D表示数・未配置数は本体物体、画像のみはtargetId=nullの数です。
原画像、枠、データは単一HTMLへ内包し、外部通信なしで利用できます。

回帰テストには23候補の合成データを使います。個人の室内写真は含めません。
テストは取り込み・保存・表示の確認であり、画像解析モデルの検出精度を評価するものではありません。
