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

## 再取り込み

`jev-room-import`補助スキルのdetections.jsonは直接指定できます。
従来のanalysis.json下書きにIDがなくても、候補名が一意なら対応付けます。
小物はunknownの寸法・設置高さを保って独立した物体にし、元のparent_idを引き継ぎます。
未配置の開口部と除外候補は画像上だけの候補に残します。
元のinput_transform、input_box、採否、有無・Box・種類の値も保存します。
response.jsonがある場合は`--response`で原回答を併せて保存できます。

```sh
node bin/oheya-kae.js room import --image room.png --analysis analysis.json --detections detections.json --response response.json
```

`--analysis`を省略すると、不明寸法の下書きから作成します。
本体は解析APIを呼び出しません。

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

推定値の修正は[推定値の修正と確認履歴](estimates.md)を参照してください。
