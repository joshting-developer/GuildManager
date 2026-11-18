# 逆水寒 · 幫會管理平台

幫會用的活動與戰績管理網站。首頁顯示活動行事曆與報名／請假, 管理者可以維護成員、安排活動與戰場排表、上傳戰績, 成員可以查看戰績與個人分析

前端使用 Vue 3、Vuetify 與 Vite, 後端使用 Node.js、Express 與 MySQL, 檔案放在私有的 Cloudflare R2

## 快速開始

需要 Node.js 22.12 以上、Docker Engine 與 Docker Compose v2。先依 [MySQL 開發說明](docs/mysql-development.md#日常開發與隔離測試分開)準備資料庫、R2 設定和 `.env`, 套用 migration 後啟動：

```sh
docker compose up --build -d
```

網站在 http://localhost:5173, API 在 http://localhost:3001。登入帳號的建立方式和其他啟動選項見[本機開發](docs/development.md)

## 常用指令

```sh
npm test
npm run build
```

`npm test` 需要四個隔離的 MySQL 測試庫, 設定方式見 [MySQL 開發說明](docs/mysql-development.md#真實-mysql-測試)

## 文件

- [文件索引](docs/README.md)：開發、部署與產品契約的完整清單
- [功能說明](docs/product-features.md)：目前各頁面的行為與權限
- [網站架構](Architecture.md)、[介面規範](Style.md)
- [正式環境](docs/production-environment.md)、[Fly.io 部署](docs/fly-deployment.md)
