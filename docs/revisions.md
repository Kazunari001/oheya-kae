# 解析・プロジェクト・HTMLの版

HTMLの「出力元・版を確認」に、プロジェクトID、入力JSONの絶対パス、
プロジェクト版、解析版、原回答の履歴ごとの版、出力日時、出力者の区分を表示します。
すべてHTML内に埋め込まれ、オフラインでも確認できます。
絶対パスには元のフォルダ名が含まれるため、共有するHTMLにも記録されます。

版はオブジェクトのキー順に依存しないJSONのSHA-256です。
プロジェクト版は正規化済みデータ全体、解析版はanalysis全体、解析履歴の版は
保持された各原回答の内容を識別します。ファイルの空白やキー順だけの変更は
版を変えません。画像・根拠・履歴・配置の変更はプロジェクト版を変えます。
同じデータの再出力では日時だけが変わり、版は変わりません。
ハッシュは内容の照合用で、署名や改ざん防止機構ではありません。

最初のCLI変更・別名保存時にprojectIdを付け、それ以降のコピーでも保持します。
旧JSONを読むだけの場合は変更せず、HTMLではroom ID等からlegacy IDを使います。
手動でJSONをコピーしてもIDを残せば同じ系統です。分岐後の違いは版で区別します。
version 1/2に対応し、保存形式のバージョンは変えません。

```sh
node bin/oheya-kae.js --project output/room.json state
node bin/oheya-kae.js --project output/room.json export --output output/room-raw.html --stage raw
node bin/oheya-kae.js --project output/room.json layout save --output output/room-corrected.json
node bin/oheya-kae.js --project output/room-corrected.json export --output output/room-corrected.html --stage corrected
```

stateのprojectRevisionとHTMLのプロジェクト版が一致すれば同じ内容です。
CLIで変更しても既存HTMLは更新されません。HTMLはローカルJSONを読み直さないため、
変更の有無を自動検知できません。版を比較して再出力してください。

--stageはsnapshot（既定）・raw（原回答版）・corrected（補正版）・
estimated（仮値補完版）から出力者が指定する区分で、内容の自動判定ではありません。
confirmedの根拠を変更せず、「原回答版」が無修正であると保証するものでもありません。
不明値版、補正版、仮値補完版はJSONとHTMLを対応する別名で保存してください。
exportは指定出力を置き換えるため、以前の版を残すときは新しい出力名が必要です。

取り込みはmetadataのない旧解析JSONでも原回答をanalysis.runsへ保持します。
再取り込みは既存履歴と異なる回答を追加し、根拠を補正しても原回答を書き換えません。
元の解析ファイル自体も別名で残すと、正規化前の入力と対応を確認できます。
