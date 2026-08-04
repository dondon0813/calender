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
| `kom.webp` | KOM | 三色不鏽鋼保溫碗（藍/綠/黃，附刻花蓋） |
| `lab52.webp` | 齒妍堂 | 汪汪隊嬰幼兒牙刷＋含鈣牙膏 |
| `ankebao.webp` | 安可堡泡泡 | Uncle Bubble 泡泡棒組 |
| `b21pro.webp` | B21pro | 粉色標籤機 |
| `bonsons.webp` | Bonsons | 白色折疊推車 |
| `bruno.webp` | Bruno | 白色電烤盤 |
| `caroline.webp` | 卡蘿琳 | 紫白包裝益生菌盒 |
| `cezi-giftbox.webp` | 冊子 | 中秋禮盒（月餅組） |
| `forest-noodle.webp` | 森林麵食 | 黃盒麵食＋木碗 |
| `giiker.webp` | Giiker | 彩色數字方塊益智機 |
| `hanba-rice.webp` | 韓爸米餅 | 黃色烤地瓜米餅袋 |
| `heliu.webp` | 禾流文創 | 小鼠梅西繪本 |
| `horay.webp` | Horay | 黑色大容量購物袋 |
| `jolly.webp` | Jolly | 白＋木色旋轉書櫃 |
| `jpkr-giftbox.webp` | （日/韓中秋禮盒，行事曆W欄用） | 日韓中秋禮盒 |
| `kigo.webp` | Kigo | 橘 logo＋米色兒童太陽眼鏡 |
| `lapo.webp` | Lapo | 紫白手持風扇 |
| `lmg.webp` | LMG | 米色不沾湯鍋 |
| `momax.webp` | MOMAX | 白色防偷拍定位器 |
| `nadle.webp` | Nadle | 黑白兒童腳踏車 |
| `parakito.webp` | Parakito | 綠色防蚊掛片 |
| `plantoys.webp` | plantoys | 仙人掌木質平衡玩具 |
| `sciencebaby.webp` | ScienceBaby | 磁力片盒裝 |
| `sensen.webp` | 森森星球 | 餛飩盒裝（豬豬包裝） |
| `snow-factory.webp` | 雪坊優格 | 原味優格白盒 |
| `taiwan-fleet.webp` | 台灣好車隊 | 黃色垃圾車玩具 |
| `trixie.webp` | trixie | 棕色小熊書包 |
| `xiao-v.webp` | 小V | Vitantonio 鬆餅機 |
| `yookidoo.webp` | Yookidoo | 紅白條紋戲水轉轉塔 |

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
