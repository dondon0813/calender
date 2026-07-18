# 品牌去背小圖

放「團購品牌資料庫 → 去背小圖」欄用的圖片。

## 命名規則

檔名＝品牌代號（英文小寫、用 `-` 連接），副檔名用 `.webp`。
**檔名決定這張圖對應哪個品牌**，請照下表存檔，不要自己改名。

| 檔名 | 對應品牌 | 圖片內容 |
|---|---|---|
| `haru-bag.webp` | 寶可樂收袋 | 白色手提保冷袋（haru 標） |
| `ubmom.webp` | UBMOM | 米色貓咪學習水壺 |
| `wewee.webp` | Wewee! | 乳液＋沐浴露兩瓶 |
| `picaboo.webp` | Picaboo | 黃色不鏽鋼碗＋分隔盤＋小鳥叉匙 |
| `aribebe.webp` | Aribebe | 汪汪隊藍色兒童睡袋組 |
| `bernie.webp` | 伯尼寢具 | 粉色小熊睡墊組 |

## 圖片建議

- **正方形**，這樣排在開學清單上方大小才會一致
- 背景白色或透明都可以（前台小圖框本身是白底）
- 建議轉成 `.webp`（跟 `icons/` 一樣的做法），檔案小很多

## 對應的網址

存進來之後，網址就是：

```
https://dondon0813.github.io/calender/images/brands/<檔名>
```

例如 `haru-bag.webp` → `https://dondon0813.github.io/calender/images/brands/haru-bag.webp`

## 不用手動貼網址到試算表

圖片 push 上 GitHub 後，到 Apps Script 執行 **`updateBrandThumbs`** 這個函式，
它會照上表把網址寫進「團購品牌資料庫」的「去背小圖」欄。
要新增品牌圖片時，改 `Code.gs` 裡的 `BRAND_THUMB_MAP_` 再跑一次就好。
