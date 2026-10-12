# BUGWORKS — 縦切り試作（Vertical Slice）

3D物理工作パズル **BUGWORKS** のWeb先行試作です。研究所の床・自由カメラ・レール／カーブレール／鉄球発射機／バネ装置／台／ゴール／羽根車／歯車装置／軸／可動橋／磁石装置／スイッチ／回転装置／ループの配置と接続・再生/停止/リセット・ゴールでのクリア表示までを実装しています。マスター仕様 §10 の手順 1「研究所の床＋自由カメラ＋レール＋鉄球1個＋再生/停止/リセット」**のみ** を実装しています。

> ステージ 1-1〜3-5 を遊べます（起動時のステージ選択。順番に解放。「自由研究」では制限なしで置けます）。
> 設計図は上のバーの「設計図」から、この端末に保存するか JSON ファイルに書き出せます（読み込みは自由研究で）。クリアの記録と端末に保存した設計図はこのブラウザの中にだけ残り、ブラウザのデータを消すと消えます。残したい設計図はファイルに書き出してください。
> 隠しバグは3種（発見すると「図鑑」に登録）、設計図は「つなげる」で連結できます。効果音は上のバーで ON/OFF できます。
> 永久機関認定・残りの隠しバグは **未実装** です（`TODO.md`）。
> サーバー / SNS / オンラインランキング / クラウド共有は実装しません（仕様上の対象外）。

## 起動手順

Node.js 22 以上を推奨します。

```bash
npm install        # npm 10 で "Cannot read properties of null (reading 'edgesOut')" が出る場合は: npx npm@11 install
npm run dev        # http://localhost:5173/ （--host 付きなので同一LANの iPad からも開けます）
```

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（LAN公開。iPad実機確認用） |
| `npm test` | ユニット/ヘッドレス物理テスト（Vitest, Node上で実行） |
| `npm run typecheck` | TypeScript 型検査 |
| `npm run build` | 型検査＋本番ビルド（`dist/`、相対パスの静的ファイル） |
| `npm run preview` | ビルド成果物の確認 |

### iPad 実機で確認する
1. PC と iPad を同じ Wi‑Fi に接続し `npm run dev` を実行。
2. ターミナルに出る `Network: http://<PCのIP>:5173/` を iPad の Safari で開く。
3. 操作：1本指ドラッグ＝回転、2本指ドラッグ＝平行移動、ピンチ＝ズーム。下部ボタンで 再生/一時停止・1ステップ・リセット・速度・視点リセット。

## 操作

| 入力 | 操作 |
|---|---|
| タッチ | 1本指ドラッグ：視点回転／2本指ドラッグ：平行移動／ピンチ：ズーム |
| マウス | 右ドラッグ（暫定で左ドラッグも）：回転／中ドラッグ・Shift+左ドラッグ：平行移動／ホイール：ズーム |
| キーボード | Space：再生/一時停止／`.`：1ステップ／Q・E：上下移動／矢印：平行移動 |
| 部品（初期状態のとき） | 部品をタップ：選択／部品をドラッグ：移動（近くのポートに吸着）／何もない所をタップ：選択解除 |
| 設定（初期状態のとき） | 部品を選ぶと「設定」に −／＋ が出る（発射機：速さ・角度・間隔、バネ：打ち上げの速さ・天板の傾き、台：高さ、カーブ：曲がる向き、歯車装置：ギア比、軸：長さ、磁石：向き・強さ・届く距離、直線レール：下る高さ（マイナスは上り坂）・長さ・向き（斜め）、ループ：大きさ、カーブ：向き・曲がり方・角度、回転装置：回る速さ・向き）。スイッチは「配線する」→ 発射機・磁石・回転装置をタップでつなぐ（もう一度で外す）。パネルの「サンプル」で見本の配置（バネでゴール／歯車で可動橋／磁石でゴール／スイッチで発射／いろいろなレール／回転台で分ける／ループと上り坂）を読み込める。ゴールとバネは台の上へドラッグすると上面に乗る |
| 部品のキー | R：回転／Delete：削除／Ctrl(⌘)+Z：元に戻す／Ctrl(⌘)+Shift+Z・Ctrl+Y：やり直し／Esc：選択解除 |

## 構成

```
src/
  sim/        物理（描画・DOMに非依存。Nodeでテスト可能）
    curveGeometry.ts        カーブレールの形（弧・ポート・当たり判定のメッシュ）
    drive.ts                回転を伝える装置（羽根車・歯車装置・軸・可動橋、軸の高さ、回転の伝わり）
    goal.ts                 ゴール（回収の範囲）と台（高さ）
    spring.ts               バネ装置（受け止め・縮み・打ち上げ、天板の傾き）
    launcher.ts             鉄球発射機（溝・ばね・装填口の形、発射と装填のルール、球の上限）
    constants.ts            120Hz 固定刻み（検証設定JSONから取得）
    FixedStepClock.ts       可変フレーム → 固定tick 変換（アキュムレータ）
    Simulation.ts           Rapier ワールド。step()=1tick、reset()=同レイアウトから再構築
    SimulationController.ts 再生/一時停止/1ステップ/リセット/速度 の状態機械
    catalog.ts              devices.v0.1.json の読込と実行時検査
    railGeometry.ts         レール形状・ポートのワールド座標（物理と描画で共通）
    lab.ts                  研究所の簡易床（architecture.example-layout.json の地上階）
    layout.ts               縦切り用のレール3本＋鉄球の配置
  render/LabView.ts         Three.js 描画（物理状態を読むだけ。前後tickを補間）
  edit/placement.ts         配置・接続のルール（グリッド、ポート吸着、重なり、鉄球の開始位置）。純粋関数
  edit/EditorModel.ts       配置・設定の編集と元に戻す/やり直し
  edit/params.ts            画面で変えられる装置の設定（範囲と刻み）
  input/PartDragController.ts 部品ドラッグと視点操作の振り分け
  ui/EditPanel.ts           装置パレットと選択中の部品の操作
  render/DeviceLayer.ts     配置に追従する装置の描画（ポートの輪、選択枠、発射機のばね）
  render/DriveModels.ts     羽根車・歯車装置・軸・可動橋の見た目（回る部品）
  render/GoalModels.ts      ゴールと台の見た目（ゴールは球が入ると光る）
  render/SpringModel.ts     バネ装置の見た目（天板とコイルの動き、持ち上げた装置の脚）
  render/LauncherModel.ts   鉄球発射機の見た目（ばねと押し板の動き、装填口。描画専用）
  render/RailModel.ts       レールの見た目（鋼管＋オレンジ金具＋支柱。描画専用、当たり判定は箱のまま）
  input/CameraRig.ts        自由カメラ（OrbitControls をタッチ優先で設定）
  ui/Hud.ts, style.css      HTMLテキストのUI（画像UIシートは使わない）
  stage/stages.ts           ステージ 1-1〜1-5 の定義（固定の装置・置ける装置・クリア条件・S-404 のひとこと）
  stage/StageController.ts  ステージの開始・クリア判定・進捗の保存（localStorage）
  sim/magnet.ts             磁石装置の力（磁極からの距離で弱まる。引きよせる/しりぞける）
  render/MagnetModel.ts     磁石装置の見た目（U字磁石、向きの札、届く距離の輪）
  sim/switch.ts             スイッチと信号の配線（ON の間だけ発射機・磁石が働く）
  render/SwitchModel.ts     スイッチ（レバー・ON/OFF の札）と配線のケーブルの見た目
  sim/rotator.ts            回転装置（台のレールを回して球の行き先を変える）
  render/RotatorModel.ts    回転装置の見た目（回る台とレール、向きの札）
  sim/loopGeometry.ts       ループ（縦に1周して横にずれて出る）の形
  blueprint/blueprint.ts    設計図JSONの書き出しと、検査付きの読み込み
  blueprint/store.ts        この端末（ブラウザ）への設計図の保存
  ui/BlueprintUi.ts         設計図の保存・読み込みの画面
  render/RoomModel.ts       研究所の部屋のモデル（public/models の glb）の読み込みと、カメラ側の壁を隠す処理
  sim/bugs.ts               隠しバグ（3種）の判定と効果の数値（発動の条件の文章は書かない）
  bugs/codex.ts, codexData.ts バグ図鑑の記録（この端末）と一覧
  blueprint/merge.ts        設計図の連結（ID の振り直し・置き場所探し・再検証）
  ui/BugUi.ts               バグ発見の演出と図鑑
  ui/Sound.ts, effects.ts   効果音（Web Audio で合成）、S-404 の顔、紙ふぶき
  render/LabEnvironment.ts  研究所の床・壁・背景の見た目（研究所パーツの画像を手本にコードで作る。当たり判定なし）
  ui/StageUi.ts             ステージ選択・目標とチェックリスト・クリア画面
spec/                       受領した仕様書のテキスト/JSON（画像と隠しバグの開発用資料は含めない）
tests/                      Vitest テスト、tests/e2e/*.cjs は実ブラウザ用（smoke / edit / stage）
```

### 描画と物理の分離
- 物理は **固定 1/120 秒** で `Simulation.step()` を呼ぶ。描画は `requestAnimationFrame`（端末依存の可変FPS）。
- `FixedStepClock` が実経過時間を tick 数に変換し、余りを補間係数 `alpha` として描画へ渡す。
- 1フレームの tick 数には上限（16）があり、超過分は捨てて HUD に「処理落ち」を表示（黙ってスローにしない）。
- 物理側は Three.js / DOM を import しない。テストはヘッドレスで物理だけを回す。

### 画像素材について
受領ZIP内の PNG（装置シート・UIシート・ステージ画面イメージ等）は **コンセプト/参照画像** であり、メッシュ・コライダー・リグではありません。研究所の床・壁だけは、ユーザーが用意した 3D モデル（`public/models/industrial_room_12x12.glb`、見た目専用, DECISIONS.md D-36）を使います。装置の 3D 形状はプリミティブから生成し、参照画像は一切読み込んでいません。

## 関連ドキュメント
- `DECISIONS.md` — 技術選定と、未決事項の候補・暫定判断（確定ではない）
- `docs/TEST_PLAN.md` — テスト方針
- `TODO.md` — 今後の作業
- `docs/SPEC_GAPS.md` — 仕様間/仕様と実装の不一致
