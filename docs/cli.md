# oheya-kae CLIガイド

[READMEに戻る](../README.md)

コマンドはリポジトリのルートディレクトリで実行してください。

AIがCLIで部屋・家具・配置を編集し、JSONで検証して、Three.jsのインタラクティブな単一HTMLで確認するNode.jsツールです。編集はCLIで行い、HTMLは閲覧・比較に使います。

## 起動

```sh
npm ci
npm run build
npm test
npm run demo
```

`output/demo.html`をGoogle Chromeで直接開くと、4つの家具と3つの配置案を確認できます。HTMLにはThree.js、操作用スクリプト、部屋データ、元画像を埋め込むので、閲覧時はサーバー・ネット接続・Node.jsが不要です。対応ブラウザはGoogle Chromeのみです。WebGLを有効にしてご利用ください。

CLIは`node bin/oheya-kae.js`で実行します。`npm run oheya-kae -- ...`も使えますが、AIがJSONを読む用途ではnpmのログが混ざらない直接実行を推奨します。`npm link`を行えば`oheya-kae`コマンドでも利用できます。

## 寸法から作る

```sh
node bin/oheya-kae.js room create --name "仕事部屋" --width 4000 --depth 5000 --height 2400
node bin/oheya-kae.js room opening add --id entry --type door --wall 0 --offset 400 --width 900 --height 2100 --sill 0 --clearance 1000
node bin/oheya-kae.js furniture add --id desk-1 --name "机" --kind desk --color "#b99069" --width 1200 --depth 600 --height 720 --x 2000 --z 3000 --rotation 0
node bin/oheya-kae.js furniture move --id desk-1 --x 1800 --z 800 --rotation 90
node bin/oheya-kae.js layout validate --json
node bin/oheya-kae.js export --format html --output output/room.html
```

デフォルトの保存先は`oheya-kae.json`です。別のプロジェクトは、各コマンドで先頭に`--project output/my-room.json`を付けます。既存の部屋を置き換える場合、`room create/import`には`--replace`が必要です。部屋の置き換え時も家具は保持されます。不要な家具は削除してください。

すべての長さは**mm**、位置は床上の`x,z`、家具の位置は**家具の底面の中心**です。`width`はローカルX、`depth`はローカルZ、`height`はYです。`rotation`はThree.jsのY軸回転と共通で、90°でローカル+Xが世界-Zを向きます。初期の矩形輪郭は`[[0,0],[width,0],[width,depth],[0,depth]]`です。

開口部の`wall`は輪郭の辺番号（0から）、`offset`はその辺の始点からの距離です。`sill`は床から開口部の下端までの高さ、`clearance`は部屋の内側に確保するドア前の奥行きです。窓も同じ形式で`--type window`を指定します。壁は輪郭の各辺から自動生成します。

凹形の部屋も作成できます。

```sh
node bin/oheya-kae.js room create --outline outline.json --height 2400
```

`outline.json`には`[[0,0],[4000,0],[4000,3000],[2500,3000],[2500,5000],[0,5000]]`のような単純多角形を記載します。終点に始点を再記載しないでください。自己交差、長さ0の辺、重複する開口部は拒否します。

## 画像の取り込み

PNG・JPEG・WebPを最大12枚、1枚10MB、合計30MBまで指定できます。同一の部屋・家具の画像は`--image`を繰り返します。画像は保存JSONとHTMLにdata URLで埋め込み、元ファイルを移動しても参照できるようにします。

### CLI利用側のAIで解析する（オフライン）

画像解析は呼び出し元のAIが行います。本ツールは解析用プロンプトとJSON Schemaを返し、AIが作成したJSONを元画像とともにローカルで取り込みます。外部APIへの送信や本ツール内での画像推定は行わず、APIキー・モデル設定も不要です。

```sh
node bin/oheya-kae.js schema --kind room
node bin/oheya-kae.js schema --kind furniture
```

取得したスキーマ・プロンプトと画像を呼び出し元AIへ渡し、既知の寸法や補足説明も直接伝えてください。AIが解析JSONを保存した後、次のコマンドで取り込みます。

```sh
node bin/oheya-kae.js room import --image floorplan.jpg --image room.jpg --analysis room-analysis.json
node bin/oheya-kae.js furniture import --image desk-front.jpg --image desk-side.jpg --analysis furniture-analysis.json
```

`schema`は解析用プロンプトとJSON Schemaを返します。利用側AIに画像を渡し、その形式の解析JSONを`--analysis`で取り込みます。[READMEのJSON入力例](../README.md#json入力例)を`room-analysis.json`や`furniture-analysis.json`として保存して利用できます。例示の数値・根拠は実画像に合わせて置き換えてください。オフライン取り込みは完全なSchema形式だけでなく、属性の一部だけを持つJSONも受け付けます。

部屋解析は`{"room": {...}, "furniture": [...]}`、家具解析は`{"furniture": {...}}`です。部屋の写真にある既存家具も同時に追加できます。種類は`box`, `desk`, `table`, `chair`, `sofa`, `bed`, `shelf`, `cabinet`に対応し、家具は種類・寸法・色に基づく簡単な立体で表現します。

### 画像だけを先に登録する

```sh
node bin/oheya-kae.js room import --image room.jpg
node bin/oheya-kae.js furniture import --image desk.jpg
```

`--analysis`を指定しない場合は、画像を保存し、未解析の寸法・部屋輪郭を`null`にします。自動推定は実行しません。未知の家具名・色・種類・位置には表示用の仮値と`unknown`の根拠を付けます。寸法不足の家具は3D表示を省略し、元画像・補正項目を表示します。部屋の高さが不明な場合のみ、壁は2400mmの仮表示を使い、保存値は`null`のままです。

## 補正と根拠

属性の値と`evidence`を別々に保存します。

| status | 意味 |
| --- | --- |
| `estimated` | 画像からの推定、比例補正、生成した配置案 |
| `image` | 画像に記載された値 |
| `confirmed` | CLIでユーザーが入力・確認した値 |
| `unknown` | 不明、または表示用の仮値 |

不明な寸法は`null`です。解析JSONが`confirmed`を返しても、画像取り込み時には`estimated`へ変換します。保存済みプロジェクトを読み込む場合は確認状態を維持します。

```sh
node bin/oheya-kae.js furniture update --id desk-1 --width 1200 --depth 600 --height 720
node bin/oheya-kae.js furniture update --id desk-1 --confirm color --confirm kind
node bin/oheya-kae.js room update --height 2400 --outline corrected-outline.json
node bin/oheya-kae.js room update --confirm openings
node bin/oheya-kae.js room opening update --id entry --width 850 --confirm wall --confirm offset
node bin/oheya-kae.js furniture update --id desk-1 --data clear-uncertainties.json
```

`--confirm`は既に値がある属性を確認済みにします。`null`の属性を確認済みにはできません。`uncertainties`にある「見えない部分」などの指摘を解決したら、`--data`で配列を補正してください。上記の`clear-uncertainties.json`は、[READMEの更新JSON例](../README.md#未確認項目を解消する更新json)を保存してから使用します。

`room update --data`は`name`, `outline`, `height`, `openings`, `uncertainties`、`furniture update --data`は家具の属性・寸法・位置・`uncertainties`に対応します。指定した属性は確認済みになります。ただし、部屋の`outline`・`height`と家具の`width`・`depth`・`height`を`null`にした場合は不明として扱います。名前・種類・色・位置・回転など、それ以外の属性への`null`指定はエラーになります。`openings`は配列全体を置き換えます。ID変更はできません。開口部を個別に追加・補正・削除する場合は`room opening add/update/remove`を使います。

縮尺は既知の長さに合わせて補正できます。

```sh
node bin/oheya-kae.js room scale --wall 0 --length 4000 --include-furniture
node bin/oheya-kae.js furniture scale --id desk-1 --dimension width --length 1200
```

部屋の補正は床輪郭・開口部の幅/offset/clearanceを比例変更します。`--include-furniture`は家具の幅・奥行・中心位置も変更します。高さと窓の下端高さは変更しません。部屋の辺の比率は推定のままです。家具の補正は既知の基準寸法に合わせて3寸法を比例変更し、基準寸法だけを確認済みにします。不明な寸法は補完しません。輪郭が不明な部屋は先に輪郭を入力してください。

## JSON契約と検証

推定値の更新には`--status estimated --note "根拠"`を指定できます。
検出JSON・再取り込み・更新履歴・画像枠の詳細は[検出データ](detections.md)を参照してください。

```sh
node bin/oheya-kae.js state
node bin/oheya-kae.js layout validate --json
node bin/oheya-kae.js layout validate --strict
node bin/oheya-kae.js layout save --output output/saved.json
node bin/oheya-kae.js layout load --input output/saved.json
node bin/oheya-kae.js export --format json --output output/shared.json
```

正常時は標準出力に1行の`{"ok":true,...}`を返します。変更操作は`objectId`、変更内容、`corrections`を返します。エラーは標準エラー出力に`{"ok":false,"error":{"code":"...","message":"..."}}`を返します。ヘルプ・バージョン表示は通常のテキストです。

| 終了コード | 意味 |
| --- | --- |
| 0 | コマンド成功。通常の検証は未確認項目があっても0 |
| 1 | 入力やファイルなどのエラー。プロジェクトは変更しない |
| 2 | 配置に問題あり。`--strict`では未確認項目がある場合も2 |

検証結果の`geometryValid`は現在の寸法・位置で問題がないこと、`provisional`は未確認項目があること、`valid`は問題も未確認項目もないことです。検証コマンド自体が完了した場合、問題が見つかっても`ok:true`です。

検証は回転した物体の水平の占有範囲に対するSAT、垂直範囲、凹多角形を含む部屋内包含判定、ドア前の必要空間との重なり、設置高さを含む天井高超過を使います。支持面への接触は許容し、棚・机・ラック・本・画面・照明は描画と共通の占有部を使います。時計・家電等は外接箱で扱います。ドア前の検証は開閉軌跡の厳密な判定ではありません。小物のコマンド、親子関係、version 2への移行は[支持関係・設置高さ](spatial-model.md)を参照してください。

`layout load`は入力JSONを検証したうえでプロジェクト全体を置き換えるため、保存先JSONが壊れている場合も有効なバックアップから復元できます。入力が不正な場合や保存先がロックされている場合は、保存先を変更しません。

変更はロックファイルと一時ファイルのrenameで保存します。同じプロジェクトを複数プロセスで同時編集すると`PROJECT_BUSY`を返します。プロセスの異常終了で`.lock.tmp`が残った場合は、編集プロセスが動いていないことを確認して削除してください。

## 配置案の提案・比較

```sh
node bin/oheya-kae.js layout propose --preference "通路を広く" --count 3 --clearance 600 --step 200
node bin/oheya-kae.js layout propose --preference "仕事優先" --count 3
node bin/oheya-kae.js export --output output/comparison.html
node bin/oheya-kae.js layout apply --id proposal-xxxxxxxx
```

最大3案を決定的なグリッド探索で生成します。「仕事」「work」などを含む条件ではデスクを先に配置し、窓の近くを優先します。通常は家具を壁寄りに配置し、`--clearance`で指定する家具間の空間を試みます。任意の自然言語条件を理解する最適化モデルではありません。詳しい条件はCLI利用側AIが寸法・配置のコマンドに変換できます。

各案は既存の検証で再チェックし、HTMLでは視点を保持して切り替えます。配置できない家具は元の位置を残して注意点を返します。案同士が同じになる場合もあります。通路の連結性や最適解は保証しません。配置案の位置は常に`estimated`で、実測の確認済み位置と区別します。問題がある案は`layout apply`で適用できません。部屋や家具を編集すると古い配置案は破棄します。

## 開発・確認

```sh
npm test
npm run demo
npm run test:browser
```

`npm test`はビューアーをビルドし、形状判定、根拠管理、CLIの保存・読み込み・不正入力・HTML生成、画像と解析JSONのローカル取り込みを検証します。`npm run test:browser`はすべてのOSでGoogle Chromeのみを使い、`file://`とネットワークを無効にした環境で3D、選択、視点操作、寸法表示、配置比較、元画像表示、モバイル表示を確認します。事前にGoogle Chromeをインストールしてください（開発環境では`npx playwright install chrome`でも準備できます）。

`viewer/`の編集後は`npm run build`で再ビルドし、HTMLを再出力してください。Three.jsとOrbitControlsは[公式のnpm利用方法](https://threejs.org/manual/pages/installation.html)に沿って取り込み、esbuildでIIFEにバンドルします。出力HTMLは外部import・CDN・fetchを使用しません。
