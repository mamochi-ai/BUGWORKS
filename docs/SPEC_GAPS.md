# 仕様との不一致・仕様間の矛盾

受領資料（2026-10-10 版一式）を突き合わせて見つかった不一致です。**いずれも本試作では勝手に確定していません。** 対応方針の欄は提案です。

優先順位はマスター仕様 §6：本書（マスター）＞検証設定JSON＞装置JSON＞過去のコンセプト資料。ただしステージ資料（v1.0 / stage1 v0.1）はマスターより**後**の追加資料で、この優先順位表に位置づけがありません（G-01）。

## A. 仕様間の不一致

| ID | 内容 | 出典 | 試作での扱い / 提案 |
|---|---|---|---|
| G-01 | ステージ資料の優先度が未定義。マスター §2/§12 は「ステージ数・順序は未確定」、ステージ資料 v1.0 は 8章×5＝40ステージを提案 | MASTER §2,§6,§12 / stages README | 試作はステージ未実装。優先順位表への追記が必要 |
| G-02 | 物理刻み：装置JSON `physicsStep=1/60`、隠しバグREADME「推奨60Hz」 vs マスター・検証設定・stage1資料は 120Hz | devices.v0.1 / README_bug_spec / verification.config | 120Hz を採用（マスター準拠）。バグ条件・制限の tick 表記は60Hz前提の可能性があり、秒定義へ直すか換算するか要決定 |
| G-03 | グリッド：装置/建築JSONは 0.25m、`stage1_blockout.json` は `gridSize: 1` | devices / architecture / stage1_blockout | 試作は 0.25m グリッドを表示 |
| G-04 | 装置ID体系の不一致（ゴール・台・カーブレール・羽根車・軸・可動橋は試作で追加済み, DECISIONS D-23〜D-25）：装置JSON `launcher`,`rail`,`gearbox`,`spring`,`magnet`,`rotator` vs blockout `ball_launcher`,`straight_rail`,`curved_rail`,`spring_pad`,`gear`(teeth),`goal_sensor`,`raised_platform`,`weight_trigger`,`movable_bridge` | devices / stage1_blockout | blockout の多くの種類（カーブレール、ゴール、台、トリガー、可動橋）は装置JSONに定義が無い。装置定義の追加か対応表が必要 |
| G-05 | 向きの不一致：装置JSONのレールは前方 +Z。blockout は `rotationYDegrees: 0` のままレールを +X 方向に並べている | devices / stage1_blockout | blockout をそのまま読むとレールが進行方向に対し横向きになる。どちらかの修正が必要 |
| G-06 | ステージ1の内容が資料間で異なる。v1.0：1-1「あと一本」1-2「角度の問題」1-3「三度目の正直」1-4「上に行きたい（バネ）」。stage1 v0.1：1-1「はじめの一歩」1-2「バネでジャンプ」1-3「曲がって運ぶ」1-4「歯車で動かす」。歯車は v1.0 では第3章 | stages README / stage1 README・blockout | **v0.1 を基準に決定**（ユーザー判断, DECISIONS D-26）。座標は作り直し |
| G-07 | 操作の割り当て：マスター「左クリック選択・ドラッグ配置・右ドラッグ回転」／操作ガイド画像「右ドラッグ回転」と「右クリック削除」が同じボタン／ステージ資料「1本指ドラッグで回転」 vs マスター「1本指で選択/ドラッグ、空き領域で視点操作」 | MASTER §8 / controls.png / stages README | 「部品上なら部品ドラッグ、空き領域なら回転」で試作済み（DECISIONS D-17）。iPad 実機で要評価 |
| G-08 | 設計図の保存項目：マスター §7 は `schemaVersion, engineVersion, physicsProfile, seed, devices, connections, ports, initialState`。stage1 README は `schemaVersion, stageId, parts, connections, creatorDefinedName`（`parts` と `devices`、`creatorDefinedName` と `title` の名称差、stageId がマスターに無い） | MASTER §7 / stage1 README | マスター §7 を基準に実装。stageId は任意キー、parts→devices・creatorDefinedName→title に読み替え（DECISIONS D-34） |
| G-09 | 証明書サンプルの `triggeredBugIds: ["infinite_loop"]` が、バグJSONのID体系 `BUG-03`（無限ループ君）と一致しない | certificate.example / hidden_bugs_developer | 未実装。`BUG-xx` に統一する案 |
| G-10 | 回転表現：建築仕様は `rotation: quaternion_xyzw` と宣言しているが、配置例は `rotationYDeg`、blockout は `rotationYDegrees` | architecture.modules / example-layout / blockout | 試作は Y軸度数（90度スナップ想定）を内部で使用 |
| G-11 | 原点の定義：建築モジュールは `bounding_box_center`、装置JSONは未記載（ポートの y が 0〜高さに分布しており接地面原点に見える） | architecture.modules / devices | DECISIONS D-05 |
| G-12 | 設計図ルートの `ports` キーの役割が不明（ポートは装置定義側にあり、接続は `connections` が持つ） | MASTER §7 | 空配列で保存（役割が決まるまで使わない, D-34） |
| G-13 | 公開図鑑JSONに未発見バグの効果文 `description_unlocked` がそのまま入っている。発動条件ではないが、配信物に含めると効果が事前に読める | bug_codex_public | 試作では未使用。図鑑実装時は発見時にだけ参照する構造か、配信方法を要検討（DECISIONS D-12） |
| G-14 | ASSET_INVENTORY は画像ZIPを「別途保管（未同梱）」としているが、2026-10-10 の一括ZIPには同梱されている | ASSET_INVENTORY.csv / README_収録一覧 | 一覧の状態更新が必要 |
| G-15 | stage1 README の時間表（1-4「歯車と橋」）とステージ v1.0 の初回5分表（2:40 バネ、3:30 異常ヒント）が一致しない | stage1 README / stages README | v0.1 の流れを採用（D-26）。時間表は未使用 |
| G-17 | 発射機の `angleDegrees: 45` はレールへの送り出しと両立しない（45°で撃つとレールを飛び越える）。角度の意味（打ち上げ角か、アームの傾きか）が未定義 | devices.v0.1 | 角度＝溝の傾き（後端が軸）。レールにつないでいる間は 0° に固定（DECISIONS D-18） |
| G-18 | 発射機の `ball_out`（z=0.65）が外形（奥行き1.4の半分＝0.7）の内側にあり、レールをつなぐと外形が重なる。ポート座標が外形の内側にある装置はほかにも無いか要確認 | devices.v0.1 | 接続している2台は重なり判定から除外（D-15） |
| G-19 | 発射機の発射回数（1回か連続か）が未定義 | devices.v0.1 | 連続で確定（ユーザー判断, D-18） |
| G-20 | バネの反発係数 0.85 だけでは落ちた高さの約72%までしか戻らず、ステージ資料の「バネで高所へ送る」（1-4 / 1-2）ができない | devices.v0.1 / stages README / stage1 blockout | 受け止めて縮み、打ち上げる方式で確定（ユーザー判断, D-21）。打ち上げの速さは新しい値 |
| G-21 | バネの高さ（0.65m）が、床置きのレールの出口（0.15m）より高い。床の上だけでは球をバネに乗せられない | devices.v0.1 | 最初の配置を 0.6m 持ち上げた（D-21）。ステージの配置（blockout の spring_pad は y=0）と合わせて見直しが必要 |
| G-22 | バネの `impact` ポート（ball 型）の役割が未定義（入口/出口のどちらでもない）。傾きの指定も無い | devices.v0.1 | 天板の上面中心として使い、接続の対象にはしない。傾きは新しい値 `tiltDegrees`（D-21） |
| G-23 | 歯車を回す力の元（球・モーター）、gearRatio の向き（出力÷入力か逆か）、軸の高さの規則が未定義。ステージ資料の gear（teeth）と装置JSONの gearbox（gearRatio）も対応が無い | devices.v0.1 / stage1 blockout | 球で回る羽根車・出力＝入力×ギア比・軸は床から0.65m（D-25） |
| G-24 | 磁石の `maxForceNewton: 20` は力（N）だが、鉄球の質量が定義されていない（物理エンジンの密度は相対値）。距離による弱まり方、磁極の位置、`mode` の値（attract 以外の名前）も未定義 | devices.v0.1 | 基準の鉄球（2kg）に掛かる力として加速度に直す（20N→10m/s²）、(1−距離/半径)² で弱まる、磁極は前面の高さ0.6m、しりぞけるは repel と解釈（DECISIONS D-29） |
| G-25 | signal ポートの意味（発射機の trigger、磁石・回転装置の enable、バネの impact_signal）と、信号を出す装置（スイッチ）、信号のつなぎ方が未定義。ポートは位置を合わせて接続する前提だが、信号は離れた装置どうしをつなぐことが多い | devices.v0.1 / MASTER §3 | スイッチ（試作）を追加し、タップで配線（位置を合わせない）。信号は ON/OFF の状態で、ON の間だけ効く（DECISIONS D-30）。バネの impact_signal は未使用 |
| G-26 | 回転装置（rotator）が何を回すか、球の入口・出口、shaft_in（軸の入口）と enable（信号）の役割が未定義 | devices.v0.1 | 台の上の短いレールを回して球の行き先を変える分岐器として試作。球の入口・出口（前・左・右）を追加し、shaft_in は使わない（DECISIONS D-32） |
| G-16 | 鉄球の半径・質量、レール断面（内幅・壁高）、`slopeMeters` の意味がどの資料にも無い | devices | DECISIONS D-06, D-07 |

## B. 試作と仕様の差（意図的な未実装・仮実装）

| 項目 | 仕様 | 試作の状態 |
|---|---|---|
| 歯車装置・羽根車・軸・可動橋 | gearbox は主要装置、他はステージ資料のみ | 試作（球で羽根車が回り、歯車装置と軸を通って可動橋が下りる）。rotator は未実装（D-25） |
| カーブレール | ステージ資料のみ（装置JSONに無い） | 試作で追加（90°・半径1.25m、左右は設定）（D-24）。急なカーブ（半径0.75m）と45°の曲がり始め／終わりを設定で追加（D-31） |
| ゴール・台 | ステージ資料のみ（装置JSONに無い） | 試作で追加（ゴールで回収して数え、最初の1個でクリア表示。台は高さ設定可）（D-23） |
| バネ装置 | 主要装置 | 実装済み（受け止め→縮み→打ち上げ、打ち上げの速さと天板の傾きの設定）。impact_signal は未実装（D-21, D-22） |
| 鉄球発射機 | 主要装置 | 実装済み（配置・接続・間隔ごとの発射・球の上限・速さ/角度/間隔の設定）。trigger 信号は未実装（D-18, D-19, D-22） |
| 装置配置・ポート接続・パレット | §2-1,2 | レールのみ実装（追加・移動・回転・高さ・削除・元に戻す、ポート吸着、接続不可の理由表示）。他の装置は未実装 |
| 再生速度調整 | §2-3 | 0.25/0.5/1/2倍を実装 |
| 研究所 | architecture.example-layout | 地上階の床9枚と北・西の壁のみ。2階・階段なし。南・東に**仕様外の縁石**（D-08） |
| 隠しバグ・図鑑・S-404 | §4, §8 | なし |
| 永久機関検証 | §5 | なし（同一プロセス内の決定論テストのみ） |
| 設計図JSON | §7 | なし |
| Web Worker | §9 推奨 | 物理はメインスレッド |
| ローカル保存（IndexedDB） | §9 | なし |
| オフライン（PWA） | §11 | 未定義・未実装。ただし外部CDN・ネットワーク通信は一切行わない |
