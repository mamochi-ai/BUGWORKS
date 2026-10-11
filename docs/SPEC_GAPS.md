# 仕様との不一致・仕様間の矛盾

受領資料（2026-10-10 版一式）を突き合わせて見つかった不一致です。**いずれも本試作では勝手に確定していません。** 対応方針の欄は提案です。

優先順位はマスター仕様 §6：本書（マスター）＞検証設定JSON＞装置JSON＞過去のコンセプト資料。ただしステージ資料（v1.0 / stage1 v0.1）はマスターより**後**の追加資料で、この優先順位表に位置づけがありません（G-01）。

## A. 仕様間の不一致

| ID | 内容 | 出典 | 試作での扱い / 提案 |
|---|---|---|---|
| G-01 | ステージ資料の優先度が未定義。マスター §2/§12 は「ステージ数・順序は未確定」、ステージ資料 v1.0 は 8章×5＝40ステージを提案 | MASTER §2,§6,§12 / stages README | 試作はステージ未実装。優先順位表への追記が必要 |
| G-02 | 物理刻み：装置JSON `physicsStep=1/60`、隠しバグREADME「推奨60Hz」 vs マスター・検証設定・stage1資料は 120Hz | devices.v0.1 / README_bug_spec / verification.config | 120Hz を採用（マスター準拠）。バグ条件・制限の tick 表記は60Hz前提の可能性があり、秒定義へ直すか換算するか要決定 |
| G-03 | グリッド：装置/建築JSONは 0.25m、`stage1_blockout.json` は `gridSize: 1` | devices / architecture / stage1_blockout | 試作は 0.25m グリッドを表示 |
| G-04 | 装置ID体系の不一致：装置JSON `launcher`,`rail`,`gearbox`,`spring`,`magnet`,`rotator` vs blockout `ball_launcher`,`straight_rail`,`curved_rail`,`spring_pad`,`gear`(teeth),`goal_sensor`,`raised_platform`,`weight_trigger`,`movable_bridge` | devices / stage1_blockout | blockout の多くの種類（カーブレール、ゴール、台、トリガー、可動橋）は装置JSONに定義が無い。装置定義の追加か対応表が必要 |
| G-05 | 向きの不一致：装置JSONのレールは前方 +Z。blockout は `rotationYDegrees: 0` のままレールを +X 方向に並べている | devices / stage1_blockout | blockout をそのまま読むとレールが進行方向に対し横向きになる。どちらかの修正が必要 |
| G-06 | ステージ1の内容が資料間で異なる。v1.0：1-1「あと一本」1-2「角度の問題」1-3「三度目の正直」1-4「上に行きたい（バネ）」。stage1 v0.1：1-1「はじめの一歩」1-2「バネでジャンプ」1-3「曲がって運ぶ」1-4「歯車で動かす」。歯車は v1.0 では第3章 | stages README / stage1 README・blockout | 未実装。どちらを正とするか要決定 |
| G-07 | 操作の割り当て：マスター「左クリック選択・ドラッグ配置・右ドラッグ回転」／操作ガイド画像「右ドラッグ回転」と「右クリック削除」が同じボタン／ステージ資料「1本指ドラッグで回転」 vs マスター「1本指で選択/ドラッグ、空き領域で視点操作」 | MASTER §8 / controls.png / stages README | 試作は配置機能が無いので1本指=回転。配置実装時に「部品上なら部品ドラッグ、空き領域なら回転」で両立できるか検証（DECISIONS D-09） |
| G-08 | 設計図の保存項目：マスター §7 は `schemaVersion, engineVersion, physicsProfile, seed, devices, connections, ports, initialState`。stage1 README は `schemaVersion, stageId, parts, connections, creatorDefinedName`（`parts` と `devices`、`creatorDefinedName` と `title` の名称差、stageId がマスターに無い） | MASTER §7 / stage1 README | 未実装。マスターを基準にし、stageId を任意キーとして追加する案 |
| G-09 | 証明書サンプルの `triggeredBugIds: ["infinite_loop"]` が、バグJSONのID体系 `BUG-03`（無限ループ君）と一致しない | certificate.example / hidden_bugs_developer | 未実装。`BUG-xx` に統一する案 |
| G-10 | 回転表現：建築仕様は `rotation: quaternion_xyzw` と宣言しているが、配置例は `rotationYDeg`、blockout は `rotationYDegrees` | architecture.modules / example-layout / blockout | 試作は Y軸度数（90度スナップ想定）を内部で使用 |
| G-11 | 原点の定義：建築モジュールは `bounding_box_center`、装置JSONは未記載（ポートの y が 0〜高さに分布しており接地面原点に見える） | architecture.modules / devices | DECISIONS D-05 |
| G-12 | 設計図ルートの `ports` キーの役割が不明（ポートは装置定義側にあり、接続は `connections` が持つ） | MASTER §7 | 未実装。要定義 |
| G-13 | 公開図鑑JSONに未発見バグの効果文 `description_unlocked` がそのまま入っている。発動条件ではないが、配信物に含めると効果が事前に読める | bug_codex_public | 試作では未使用。図鑑実装時は発見時にだけ参照する構造か、配信方法を要検討（DECISIONS D-12） |
| G-14 | ASSET_INVENTORY は画像ZIPを「別途保管（未同梱）」としているが、2026-10-10 の一括ZIPには同梱されている | ASSET_INVENTORY.csv / README_収録一覧 | 一覧の状態更新が必要 |
| G-15 | stage1 README の時間表（1-4「歯車と橋」）とステージ v1.0 の初回5分表（2:40 バネ、3:30 異常ヒント）が一致しない | stage1 README / stages README | G-06 と合わせて整理 |
| G-16 | 鉄球の半径・質量、レール断面（内幅・壁高）、`slopeMeters` の意味がどの資料にも無い | devices | DECISIONS D-06, D-07 |

## B. 試作と仕様の差（意図的な未実装・仮実装）

| 項目 | 仕様 | 試作の状態 |
|---|---|---|
| 鉄球発射機 | 主要装置 | なし。鉄球はレール入口に静置して開始 |
| 装置配置・ポート接続・パレット | §2-1,2 | なし。レール3本は固定配置（接続はポート座標一致をテストで確認のみ） |
| 再生速度調整 | §2-3 | 0.25/0.5/1/2倍を実装 |
| 研究所 | architecture.example-layout | 地上階の床9枚と北・西の壁のみ。2階・階段なし。南・東に**仕様外の縁石**（D-08） |
| 隠しバグ・図鑑・S-404 | §4, §8 | なし |
| 永久機関検証 | §5 | なし（同一プロセス内の決定論テストのみ） |
| 設計図JSON | §7 | なし |
| Web Worker | §9 推奨 | 物理はメインスレッド |
| ローカル保存（IndexedDB） | §9 | なし |
| オフライン（PWA） | §11 | 未定義・未実装。ただし外部CDN・ネットワーク通信は一切行わない |
