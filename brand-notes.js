/* ============================================================
   品牌小備註庫（calendar-poster.html 的貼文文案用）
   ------------------------------------------------------------
   這是「跟著品牌走」的一句話介紹，貼文裡 👉🏻 那行就是從這裡來的。
   行事曆的團名每月寫法可能不同（例：「Lapo 製冷風扇」/「Lapo風扇」），
   所以比對是用 keys 陣列做關鍵字比對，不是整串相等。

   要新增／修改備註，直接改這個檔就好，不用動 calendar-poster.html。
     brand : 品牌全名（給人看的，比對時不使用）
     keys  : 比對用關鍵字（小寫、忽略空白與符號；命中最長的那個）
     note  : 貼文裡 👉🏻 後面那句
   來源：2026-06 貼文（使用者提供）
   ============================================================ */
window.BRAND_NOTES = [
  { brand: 'Lassig 泳衣',              keys: ['lassig'],                              note: '有尿布泳褲！裡面不用再穿一游泳尿布超方便！' },
  { brand: '三麗鷗兒童相機',           keys: ['三麗鷗兒童相機', '兒童相機'],           note: '新品布丁狗上市' },
  { brand: '淨毒五郎',                 keys: ['淨毒五郎'],                             note: '超好用的清潔用品！此團新品洗衣球！' },
  { brand: 'Classic World 木製玩具',   keys: ['classicworld'],                         note: 'CP值爆高的木製玩具，此團加碼免費教材唷' },
  { brand: '台東初鹿保久乳',           keys: ['初鹿'],                                 note: '1歲以上就可以直接取代奶粉！告別洗奶瓶！' },
  { brand: 'QUUT 玩水玩具',            keys: ['quut'],                                 note: '無接縫的玩水玩具、泳池' },
  { brand: 'Ariati 軟磁鐵',            keys: ['ariati'],                               note: '韓國爆紅學習軟磁鐵！盒裝外出超方便！' },
  { brand: 'Lapo 製冷風扇',            keys: ['lapo'],                                 note: '2026強勢新品！可以夾推車+自轉！' },
  { brand: 'Cova ai 風扇涼墊',         keys: ['cova'],                                 note: '2026最新！水冷功能的風扇涼墊' },
  { brand: '森林麵食',                 keys: ['森林麵食'],                             note: '常溫保存的寶寶蔬果麵' },
  { brand: 'Parakito 寶寶防蚊',        keys: ['parakito'],                             note: '成份天然的寶寶防蚊' },
  { brand: '年年姓名貼',               keys: ['年年姓名貼'],                           note: '此團有雪莉聯名限定款！' },
  { brand: 'Scoot & Ride 滑步車',      keys: ['scoot', '滑步車'],                      note: '每個小孩都必須要有一台！超爆推🔥' },
  { brand: 'Silipot 矽膠廚具',         keys: ['silipot'],                              note: '好用的矽膠烤模、夾子、筷子、氣炸鍋內鍋' },
  // 6 月是 yookidoo + trixie 合團，這裡拆成兩筆，兩筆先沿用同一句（需要時各自改）
  { brand: 'Yookidoo 洗澡／戲水玩具',  keys: ['yookidoo'],                             note: '夏天必備洗澡玩具、浴袍、開學書包' },
  { brand: 'trixie',                   keys: ['trixie'],                               note: '夏天必備洗澡玩具、浴袍、開學書包' },
  { brand: 'Mongdies 物理防曬',        keys: ['mongdies'],                             note: '無限回購的好用防曬乳、防曬氣墊、防曬棒' },
  { brand: '雪坊優格',                 keys: ['雪坊'],                                 note: '每個月23-25號開團，團團抽整單免費！' },
  { brand: 'Stokke Jetkids 騎行箱',    keys: ['jetkids', 'stokke'],                    note: '強勢新品超爆推🔥解放雙手小朋友可以自己騎！' },
  { brand: 'Aspor 3C',                 keys: ['aspor'],                                note: '防爆固態行動電源、快充線、製冷風扇' },
  { brand: 'Pato Pato 遊戲地墊',       keys: ['patopato'],                             note: '台灣製造的遊戲巧拼！無毒安全！' },
  { brand: 'B21 Pro 三麗鷗標籤機',     keys: ['b21', '三麗鷗標籤機'],                  note: '收納控必備！自己印標籤超方便！' },
  { brand: 'Kigo 太陽眼鏡',            keys: ['kigo'],                                 note: '抗uv太陽眼鏡，安全鏡片不碎裂' }
];
