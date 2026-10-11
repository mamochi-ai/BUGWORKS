# BUGWORKS — 縦切り試作（Vertical Slice）

3D物理工作パズル **BUGWORKS** のWeb先行試作です。研究所の床・自由カメラ・レール／カーブレール／鉄球発射機／バネ装置／台／ゴールの配置と接続・再生/停止/リセット・ゴールでのクリア表示までを実装しています。マスター仕様 §10 の手順 1「研究所の床＋自由カメラ＋レール＋鉄球1個＋再生/停止/リセット」**のみ** を実装しています。

> 隠しバグ・永久機関認定・装置配置・設計図保存は **未実装** です（`TODO.md`）。
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
| 設定（初期状態のとき） | 部品を選ぶと「設定」に −／＋ が出る（発射機：速さ・角度・間隔、バネ：打ち上げの速さ・天板の傾き、台：高さ、カーブ：曲がる向き）。ゴールとバネは台の上へドラッグすると上面に乗る |
| 部品のキー | R：回転／Delete：削除／Ctrl(⌘)+Z：元に戻す／Ctrl(⌘)+Shift+Z・Ctrl+Y：やり直し／Esc：選択解除 |

## 構成

```
src/
  sim/        物理（描画・DOMに非依存。Nodeでテスト可能）
    curveGeometry.ts        カーブレールの形（弧・ポート・当たり判定のメッシュ）
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
  render/GoalModels.ts      ゴールと台の見た目（ゴールは球が入ると光る）
  render/SpringModel.ts     バネ装置の見た目（天板とコイルの動き、持ち上げた装置の脚）
  render/LauncherModel.ts   鉄球発射機の見た目（ばねと押し板の動き、装填口。描画専用）
  render/RailModel.ts       レールの見た目（鋼管＋オレンジ金具＋支柱。描画専用、当たり判定は箱のまま）
  input/CameraRig.ts        自由カメラ（OrbitControls をタッチ優先で設定）
  ui/Hud.ts, style.css      HTMLテキストのUI（画像UIシートは使わない）
spec/                       受領した仕様書のテキスト/JSON（画像と隠しバグの開発用資料は含めない）
tests/                      Vitest テスト、tests/e2e/smoke.cjs は実ブラウザ用
```

### 描画と物理の分離
- 物理は **固定 1/120 秒** で `Simulation.step()` を呼ぶ。描画は `requestAnimationFrame`（端末依存の可変FPS）。
- `FixedStepClock` が実経過時間を tick 数に変換し、余りを補間係数 `alpha` として描画へ渡す。
- 1フレームの tick 数には上限（16）があり、超過分は捨てて HUD に「処理落ち」を表示（黙ってスローにしない）。
- 物理側は Three.js / DOM を import しない。テストはヘッドレスで物理だけを回す。

### 画像素材について
受領ZIP内の PNG（装置シート・UIシート・ステージ画面イメージ等）は **コンセプト/参照画像** であり、メッシュ・コライダー・リグではありません。本試作は 3D 形状をすべてプリミティブ（箱・球）から生成し、画像ファイルは一切読み込んでいません。

## 関連ドキュメント
- `DECISIONS.md` — 技術選定と、未決事項の候補・暫定判断（確定ではない）
- `docs/TEST_PLAN.md` — テスト方針
- `TODO.md` — 今後の作業
- `docs/SPEC_GAPS.md` — 仕様間/仕様と実装の不一致
