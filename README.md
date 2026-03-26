# single-lge-balance-webapp

スマートフォン（横向き）で使う、片脚バランストレーニング Web アプリの最小実装です。
DeviceOrientation を使って揺れを簡易表示し、セッションログを localStorage に保存します。

## セットアップ

```bash
npm install
npm run dev
```

- 開発サーバー起動後、表示された URL をスマートフォンブラウザで開いてください。
- iOS Safari はセンサー許可ダイアログが出るため、許可が必要です。

## 実装済み画面

1. 開始画面（脚・時間の選択、開始、前回設定保持）
2. 準備確認画面（姿勢案内、校正ボタン、未校正時は進行不可）
3. 3秒カウントダウン画面
4. 練習画面（ターゲット円、現在位置点、残り時間、停止）
5. 終了画面（再実行、反対脚、ホーム）

## ログ保存

localStorage キー: `balance_app_logs_v1`

保存項目:
- session_id
- date
- leg
- target_duration_sec
- actual_duration_sec
- completed
- calibration_done
- mean_sway_index
- sd_sway_index
- max_sway_index
- time_in_target_ratio

## 未解決点 / 今後の改善

- センサ値は端末・ブラウザによって感度差が大きく、正規化の調整が必要
- 現在は DeviceOrientation のみ利用（DeviceMotion 併用やフィルタ処理未実装）
- UI は最小構成のため、アクセシビリティ・多言語対応は未対応
- ログのエクスポート/削除 UI は未実装
- 医療用途を想定した精度検証は未実施
