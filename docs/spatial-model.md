# 物体・支持関係・設置高さ

保存形式version 2では、家具に加えて小物を`objects`へ保存します。
時計・本・家電等の意味は`category`、簡易形状は`kind`で指定します。
従来の8種類に加え、`clothes_rack`、`clock`、`books`、`appliance`、
`screen`、`lamp`を使えます。衣類ラックは支柱・横棒・脚、本は5冊のまとまり、
画面は台座付き、時計は円盤と針で表示します。`box`は外接箱による仮表示です。
取り込み時に未対応のkindがあればcategoryと注意書きを残してboxに変換します。
検出IDは任意の`sourceId`に保持できます。画像上の検出枠と3D座標は別の情報です。

## 座標と関係

長さはmm、角度は度です。`height`は物体自体の高さ、`y`は底面の設置高さです。
`x,z`は底面中心。`rotation`はThree.jsの正のY軸回転で、90度でローカル+Xが世界-Zへ向きます。

| attachment | parentId | 座標の基準と条件 |
| --- | --- | --- |
| `floor` | null | 部屋の床。通常y=0 |
| `on` | 支持物のID | 親の底面中心からの相対x,y,zと相対回転。底面を支持面に接触させる |
| `inside` | 棚等のID | 親からの相対座標。surfaceId必須。内容物を親の範囲へ収める |
| `wall` | 部屋のID | 部屋の座標。wallで輪郭の辺を指定し、その壁に物体を接触させる |
| `part` | 構成元のID | 一体構造の構成物。親からの相対座標。親の範囲へ収める |

親の回転・位置から子の世界座標を計算するため、親だけを移動しても子は追従します。
親からの相対座標は保存時に世界座標へ書き換えません。親子・支持面の指定自体にも
`evidence`を付けられます。関係があるだけで衝突検証を免除するものではありません。

`y: null`は設置高さ不明で、親の高さが不明なら子にも伝播します。
該当物体の3D形状は省略し、属性一覧と`POSITION_UNKNOWN`を表示します。
仮の3D表示を作る場合は、利用側AIが数値と`estimated`の根拠を与えてください。

## 棚の支持面

開放棚には`supports`で棚板を定義します。各面の`id`は親の中で一意です。
`y`は棚板の上面、`thickness`は板厚。省略時の板厚と支柱厚は20mmです。
支持面のx,zは親の底面中心が基準で、省略時は0です。

`shelf.json`として次を保存する例です。

```json
{
  "id": "shelf",
  "name": "金属棚",
  "kind": "shelf",
  "category": "metal_shelf",
  "width": 1200,
  "depth": 500,
  "height": 1900,
  "x": 900,
  "z": 1000,
  "rotation": 90,
  "frameThickness": 20,
  "supports": [
    {"id": "lower", "y": 100, "width": 1200, "depth": 500},
    {"id": "middle", "y": 900, "width": 1200, "depth": 500},
    {"id": "upper", "y": 1800, "width": 1200, "depth": 500}
  ]
}
```

```sh
node bin/oheya-kae.js --project output/spatial.json room create --width 4000 --depth 5000 --height 2400
node bin/oheya-kae.js --project output/spatial.json furniture add --data shelf.json
node bin/oheya-kae.js --project output/spatial.json object add --id books --name "下段の本" --category book_group --kind box --width 500 --depth 300 --height 300 --parent-id shelf --attachment inside --surface-id lower --x 0 --y 100 --z 0 --rotation 0
node bin/oheya-kae.js --project output/spatial.json object add --id oven --name "中段の家電" --category appliance --kind box --width 500 --depth 350 --height 400 --parent-id shelf --attachment inside --surface-id middle --x 0 --y 900 --z 0 --rotation 0
node bin/oheya-kae.js --project output/spatial.json export --output output/spatial.html
```

台や机に明示的な支持面がない場合、`on`は親の上面（親のheight）を使います。
棚板を定義した親では、`on`も`inside`も`surfaceId`を指定してください。
`supports`のある棚は支柱と棚板を描画・検証し、内容物を隠す全面の箱は作りません。
未指定の棚やその他の形状は従来の簡易形状を使います。

## 取り込み・編集

`schema --kind room`は任意の`objects`配列と支持関係の属性を含みます。
解析JSONの`room`・`furniture`・`objects`に安定した`id`を付け、`parentId`で参照します。
`room import --image ... --analysis ...`でまとめて取り込めます。
単体は`schema --kind object`と`object import --image ... --analysis ...`を使います。
単体解析の包みは`{"object": {...}}`です。

`object add/update/remove`で小物を操作できます。家具の支持面は
`furniture add/update --data`のJSONで指定します。
`furniture move --y`も指定でき、親の位置・回転変更に子が追従します。
子を残したまま親を削除する変更は保存前に拒否し、元ファイルを保持します。
IDの重複・参照先不存在・循環・不正な支持面も保存前に拒否します。

CLIで入力した値は従来どおり確認済みとして扱います。
AIの仮値は解析JSONの`evidence`に`estimated`を指定して取り込んでください。
推定としての既存属性の更新と、検出Boxの統合取り込みは後続課題です。

## 配置検証と範囲

物体同士は水平の占有範囲と垂直の範囲を組み合わせて検証します。
支持面への接触は許容しますが、棚板・支柱の貫通、支持面からのはみ出し、
浮き、床へのめり込み、設置高さを含む天井超過は警告します。
ドア前の必要空間は床から開口上端までとし、その上の物体は通行障害に含めません。
棚・机・衣類ラック・本・画面・照明の占有部は描画と共有します。
時計・家電や従来のその他の形状は外接箱による保守的な検証です。
耐荷重、壁への固定の強度、家電の放熱や精密な形状までは検証しません。

配置案の探索は床置きの独立した家具が対象です。その子である小物は追従します。
家具自体が親に取り付けられている場合や床より高い場合は、現状の探索を拒否します。
一体構造全体の配置探索と、高度な形状の追加は後続課題です。
支持面や子がある家具の比例補正、および支持関係がある場面での
`room scale --include-furniture`は、未対応のまま寸法を壊さないよう拒否します。
各面・子の寸法を明示的に更新してください。

version 1は読み込み時にversion 2へ移行し、旧家具はy=0の床置きになります。
書き出しはversion 2。旧版のCLIはversion 2を読み込めないため、戻す場合は旧ファイルを残してください。
未対応のversion番号は拒否します。単一HTMLのオフライン表示は維持します。
