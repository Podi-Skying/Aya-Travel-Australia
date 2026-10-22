/*
 * Aya 澳洲旅程｜行程資料（草稿）
 * ------------------------------------------------------------
 * 所有活動、時間、價格皆為「建議草稿」與「估計值」，尚未向官方來源查核。
 * 來源連結為官方或營運商首頁，出發前請逐一確認開放時間、票價與交通。
 *
 * 欄位說明
 *   pri:    must = 必去、pref = 優先、repl = 可替換
 *   mode:   抵達此活動的主要交通方式 walk / bus / drive / ferry / train / flight
 *   travel: 抵達前的交通時間拆分（分鐘）{ drive, walk, wait, ferry, transit, flight }
 *   cost.unit: pp = 每人、group = 整組、shared = 共乘分攤（依 participants 人數）
 *   cost.status: estimate = 估計、quote = 報價、confirmed = 已確認、unknown = 未知
 *   verify: verified / partial / unverified
 */
window.TRIP_DATA = {
  meta: {
    title: "Aya 的澳洲旅程",
    subtitle: "塔斯馬尼亞 × 雪梨｜2026 年 10–11 月",
    start: "2026-10-25",
    end: "2026-11-26",
    currency: "AUD",
    defaultPartySize: 2,
    draftCreated: "2026-10-22",
    lastSync: "2026-10-22T22:30:00+11:00",
    foodPerPersonPerDay: { tas: 55, syd: 65 }
  },

  segments: {
    tas: { name: "塔斯馬尼亞", en: "Tasmania", range: "10/25–11/26（11/3–11/6 除外）", color: "#1f7a6d" },
    syd: { name: "雪梨", en: "Sydney", range: "11/3–11/6", color: "#c2643a" }
  },

  drivers: {
    Zayden: { weekdays: [1, 2, 3], label: "週一至週三（可能）", note: "可用日期、時段與是否整天皆未確認" },
    JJ: { weekdays: [6, 0], label: "週六至週日（可能）", note: "可用日期、時段與是否整天皆未確認" }
  },

  stays: {
    utas: { name: "UTAS Hobart Apartments", area: "Hobart 市區", address: "（擁有者填寫；分享時隱藏）", nightly: 0, status: "confirmed", note: "擁有者與 Aya 入住期間 AUD $0；其他人不適用" },
    coles: { name: "Coles Bay 一帶住宿（未預訂）", area: "Freycinet / Coles Bay", address: "", nightly: 230, status: "estimate", note: "建議住宿，尚未預訂；價格為估計" },
    lst: { name: "Launceston 住宿（未預訂）", area: "Launceston", address: "", nightly: 170, status: "estimate", note: "建議住宿，尚未預訂；價格為估計" },
    cradle: { name: "Cradle Mountain 一帶住宿（未預訂）", area: "Cradle Mountain", address: "", nightly: 300, status: "estimate", note: "旺季前後價格浮動大；尚未預訂" },
    syd: { name: "雪梨市區住宿（未預訂）", area: "Sydney CBD / The Rocks 附近", address: "", nightly: 260, status: "estimate", note: "建議住宿，尚未預訂；價格為估計" },
    none: { name: "離境（無住宿）", area: "", address: "", nightly: 0, status: "confirmed", note: "" }
  },

  alertsSources: [
    { name: "TasALERT 塔州緊急資訊", url: "https://www.tasalert.com/", kind: "緊急警示" },
    { name: "BoM 塔州天氣警報", url: "https://www.bom.gov.au/tas/warnings/", kind: "天氣" },
    { name: "Tasmania Parks & Wildlife Service 公園公告", url: "https://parks.tas.gov.au/", kind: "國家公園" },
    { name: "Metro Tasmania 公車", url: "https://www.metrotas.com.au/", kind: "大眾運輸" },
    { name: "BoM 新州天氣警報", url: "https://www.bom.gov.au/nsw/warnings/", kind: "天氣" },
    { name: "Live Traffic NSW 道路狀況", url: "https://www.livetraffic.com/", kind: "道路" },
    { name: "Transport for NSW 交通", url: "https://transportnsw.info/", kind: "大眾運輸" }
  ],

  days: [
    {
      date: "2026-10-25", seg: "tas", title: "抵達荷巴特・入住", stay: "utas", driveHrs: 0.5,
      items: [
        { id: "a01", time: "14:00", dur: 60, name: "抵達荷巴特機場", en: "Hobart Airport", lat: -42.8361, lng: 147.5100, pri: "must", major: false, mode: "flight", travel: {}, src: { label: "Hobart Airport", url: "https://hobartairport.com.au/" }, verify: "unverified", note: "航班時間待填", cost: { cat: "transport", amount: 0, unit: "pp", status: "unknown", note: "抵達航班費用未提供" } },
        { id: "a02", time: "15:30", dur: 60, name: "機場前往 UTAS 公寓入住", en: "UTAS Hobart Apartments", lat: -42.8826, lng: 147.3257, pri: "must", major: false, mode: "bus", travel: { transit: 30, wait: 15 }, src: { label: "Hobart Airport 交通", url: "https://hobartairport.com.au/" }, verify: "unverified", cost: { cat: "transport", amount: 22, unit: "pp", status: "estimate", note: "機場接駁巴士單程估計" } },
        { id: "a03", time: "18:00", dur: 90, name: "海濱區散步晚餐", en: "Hobart Waterfront", lat: -42.8840, lng: 147.3330, pri: "repl", major: true, mode: "walk", travel: { walk: 10 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" }
      ]
    },
    {
      date: "2026-10-26", seg: "tas", title: "威靈頓山 kunanyi 與市區", stay: "utas", needsDriver: "Zayden", driveHrs: 1,
      alt: "若無人開車：搭 kunanyi/Mt Wellington Explorer 觀光巴士上山（需另購票），或改走 Cascade 步道。",
      items: [
        { id: "a04", time: "09:30", dur: 120, name: "kunanyi / 威靈頓山山頂", en: "kunanyi / Mount Wellington", lat: -42.8960, lng: 147.2370, pri: "must", major: true, mode: "drive", travel: { drive: 30 }, src: { label: "Wellington Park", url: "https://www.wellingtonpark.org.au/" }, verify: "unverified", note: "山頂可能突降溫或因天候封路，出發前查看", cost: { cat: "tickets", amount: 0, unit: "pp", status: "estimate", note: "山頂觀景台免費" } },
        { id: "a05", time: "12:30", dur: 90, name: "Cascade 啤酒廠花園午餐", en: "Cascade Brewery", lat: -42.8960, lng: 147.2970, pri: "repl", major: true, mode: "drive", travel: { drive: 20 }, src: { label: "Cascade Brewery", url: "https://www.cascadebreweryco.com.au/" }, verify: "unverified" },
        { id: "a06", time: "15:00", dur: 120, name: "Battery Point 與 Salamanca Place", en: "Battery Point & Salamanca Place", lat: -42.8890, lng: 147.3320, pri: "pref", major: true, mode: "drive", travel: { drive: 10, walk: 10 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資與停車（共乘）", amount: 25, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-10-27", seg: "tas", title: "里奇蒙小鎮與野生動物", stay: "utas", needsDriver: "Zayden", driveHrs: 1.5,
      alt: "若無人開車：Bonorong 有部分接駁團可選；或改為市區步行日（博物館 TMAG、皇家植物園）。",
      items: [
        { id: "a07", time: "09:30", dur: 120, name: "Bonorong 野生動物保護區", en: "Bonorong Wildlife Sanctuary", lat: -42.7262, lng: 147.2463, pri: "must", major: true, mode: "drive", travel: { drive: 35 }, src: { label: "Bonorong", url: "https://bonorong.com.au/" }, verify: "unverified", cost: { cat: "tickets", amount: 40, unit: "pp", status: "estimate" } },
        { id: "a08", time: "12:30", dur: 150, name: "Richmond 小鎮與里奇蒙橋", en: "Richmond Village & Bridge", lat: -42.7350, lng: 147.4380, pri: "pref", major: true, mode: "drive", travel: { drive: 25 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" },
        { id: "a09", time: "16:00", dur: 60, name: "Coal River Valley 酒莊", en: "Coal River Valley wineries", lat: -42.7700, lng: 147.4300, pri: "repl", major: true, mode: "drive", travel: { drive: 10 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified", note: "司機不飲酒" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 30, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-10-28", seg: "tas", title: "Mount Field 國家公園瀑布", stay: "utas", needsDriver: "Zayden", driveHrs: 2.5, hike: true,
      alt: "若無人開車：改為市區或渡輪可達的行程（例如 MONA），Mount Field 移到司機確認的日子。",
      items: [
        { id: "a10", time: "09:00", dur: 60, name: "購買國家公園通行證", en: "Parks Pass (Holiday Pass)", lat: -42.6830, lng: 146.7160, pri: "must", major: false, mode: "drive", travel: { drive: 75 }, src: { label: "Parks Pass", url: "https://passes.parks.tas.gov.au/" }, verify: "unverified", note: "Holiday Pass 每車計價，可涵蓋之後數週的國家公園；換車可能需另購", cost: { cat: "tickets", amount: 95, unit: "shared", participants: 3, status: "estimate" } },
        { id: "a11", time: "10:15", dur: 90, name: "Russell Falls 羅素瀑布", en: "Russell Falls", lat: -42.6800, lng: 146.7150, pri: "must", major: true, mode: "walk", travel: { walk: 15 }, src: { label: "Mount Field National Park", url: "https://parks.tas.gov.au/explore-our-parks/mount-field-national-park" }, verify: "unverified" },
        { id: "a12", time: "12:30", dur: 120, name: "Tall Trees 巨木步道與 Lady Barron Falls", en: "Tall Trees Walk & Lady Barron Falls", lat: -42.6740, lng: 146.7000, pri: "repl", major: true, mode: "walk", travel: { walk: 20 }, src: { label: "Mount Field National Park", url: "https://parks.tas.gov.au/explore-our-parks/mount-field-national-park" }, verify: "unverified", note: "較長步道，可依體力縮短" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 45, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-10-29", seg: "tas", title: "市區步行日", stay: "utas", driveHrs: 0,
      items: [
        { id: "a13", time: "10:00", dur: 120, name: "塔斯馬尼亞博物館與美術館 TMAG", en: "Tasmanian Museum and Art Gallery", lat: -42.8818, lng: 147.3310, pri: "pref", major: true, mode: "walk", travel: { walk: 10 }, src: { label: "TMAG", url: "https://www.tmag.tas.gov.au/" }, verify: "unverified", cost: { cat: "tickets", amount: 0, unit: "pp", status: "estimate", note: "常設展一般免費" } },
        { id: "a14", time: "14:00", dur: 120, name: "皇家塔斯馬尼亞植物園", en: "Royal Tasmanian Botanical Gardens", lat: -42.8650, lng: 147.3330, pri: "repl", major: true, mode: "walk", travel: { walk: 30 }, src: { label: "RTBG", url: "https://www.rtbg.tas.gov.au/" }, verify: "unverified" }
      ]
    },
    {
      date: "2026-10-30", seg: "tas", title: "搭渡輪去 MONA", stay: "utas", driveHrs: 0, ferry: true,
      items: [
        { id: "a15", time: "10:00", dur: 30, name: "Brooke St 碼頭搭 MONA 渡輪", en: "MONA Ferry, Brooke Street Pier", lat: -42.8850, lng: 147.3340, pri: "pref", major: false, mode: "walk", travel: { walk: 10, wait: 15 }, src: { label: "MONA", url: "https://mona.net.au/" }, verify: "unverified", cost: { cat: "transport", amount: 30, unit: "pp", status: "estimate", note: "來回渡輪估計" } },
        { id: "a16", time: "10:30", dur: 240, name: "MONA 新舊藝術博物館", en: "MONA – Museum of Old and New Art", lat: -42.8120, lng: 147.2620, pri: "must", major: true, mode: "ferry", travel: { ferry: 25 }, src: { label: "MONA", url: "https://mona.net.au/" }, verify: "unverified", note: "需預約入場時段", cost: { cat: "tickets", amount: 40, unit: "pp", status: "estimate" } }
      ]
    },
    {
      date: "2026-10-31", seg: "tas", title: "亞瑟港歷史遺址", stay: "utas", needsDriver: "JJ", driveHrs: 3,
      alt: "若無人開車：參加從荷巴特出發的 Port Arthur 一日遊團（費用較高，需另訂）。",
      items: [
        { id: "a17", time: "09:00", dur: 60, name: "Tasman Arch 與 Devils Kitchen", en: "Tasman Arch & Devils Kitchen", lat: -43.0480, lng: 147.9480, pri: "pref", major: true, mode: "drive", travel: { drive: 80 }, src: { label: "Tasmania Parks", url: "https://parks.tas.gov.au/" }, verify: "unverified" },
        { id: "a18", time: "10:30", dur: 240, name: "亞瑟港歷史遺址（含港灣遊船）", en: "Port Arthur Historic Site", lat: -43.1460, lng: 147.8510, pri: "must", major: true, mode: "drive", travel: { drive: 20 }, src: { label: "Port Arthur", url: "https://portarthur.org.au/" }, verify: "unverified", cost: { cat: "tickets", amount: 50, unit: "pp", status: "estimate" } },
        { id: "a19", time: "15:30", dur: 45, name: "Remarkable Cave", en: "Remarkable Cave", lat: -43.1890, lng: 147.8510, pri: "repl", major: true, mode: "drive", travel: { drive: 10 }, src: { label: "Tasmania Parks", url: "https://parks.tas.gov.au/" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 55, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-01", seg: "tas", title: "布魯尼島", stay: "utas", needsDriver: "JJ", driveHrs: 2.5, ferry: true,
      alt: "若無人開車：參加布魯尼島一日遊團；或改去 Kingston Beach（公車可達）。",
      items: [
        { id: "a20", time: "08:30", dur: 20, name: "Kettering 搭車輛渡輪", en: "Bruny Island Ferry, Kettering", lat: -43.1260, lng: 147.2470, pri: "must", major: false, mode: "drive", travel: { drive: 40, wait: 20, ferry: 20 }, src: { label: "SeaLink Bruny Island", url: "https://www.sealink.com.au/bruny-island/" }, verify: "unverified", cost: { cat: "transport", amount: 50, unit: "shared", participants: 3, status: "estimate", note: "每車來回估計" } },
        { id: "a21", time: "10:00", dur: 45, name: "The Neck 觀景台", en: "Truganini Lookout, The Neck", lat: -43.2690, lng: 147.3530, pri: "pref", major: true, mode: "drive", travel: { drive: 30 }, src: { label: "Bruny Island", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" },
        { id: "a22", time: "11:30", dur: 120, name: "Bruny Island 起司與生蠔午餐", en: "Bruny Island Cheese & Get Shucked", lat: -43.1820, lng: 147.3530, pri: "repl", major: true, mode: "drive", travel: { drive: 20 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" },
        { id: "a23", time: "14:30", dur: 120, name: "Cape Bruny 燈塔", en: "Cape Bruny Lighthouse", lat: -43.4900, lng: 147.1440, pri: "repl", major: true, mode: "drive", travel: { drive: 50 }, src: { label: "Tasmania Parks", url: "https://parks.tas.gov.au/" }, verify: "unverified", note: "部分路段為碎石路" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 45, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-02", seg: "tas", title: "輕鬆日・準備去雪梨", stay: "utas", driveHrs: 0,
      items: [
        { id: "a24", time: "10:00", dur: 120, name: "North Hobart 咖啡與 Elizabeth St 散步", en: "North Hobart", lat: -42.8710, lng: 147.3170, pri: "repl", major: true, mode: "bus", travel: { transit: 10, wait: 10 }, src: { label: "Metro Tasmania", url: "https://www.metrotas.com.au/" }, verify: "unverified", cost: { cat: "transport", amount: 6, unit: "pp", status: "estimate", note: "公車來回" } }
      ]
    },
    {
      date: "2026-11-03", seg: "syd", title: "飛往雪梨・環形碼頭", stay: "syd", driveHrs: 0,
      items: [
        { id: "a25", time: "09:00", dur: 100, name: "荷巴特 → 雪梨 航班", en: "Flight HBA → SYD", lat: -33.9399, lng: 151.1753, pri: "must", major: false, mode: "flight", travel: { transit: 30, wait: 90, flight: 100 }, src: { label: "Hobart Airport", url: "https://hobartairport.com.au/" }, verify: "unverified", note: "航班與時間待訂", cost: { cat: "transport", amount: 160, unit: "pp", status: "estimate", note: "單程經濟艙估計" } },
        { id: "a26", time: "14:00", dur: 150, name: "The Rocks 岩石區", en: "The Rocks", lat: -33.8599, lng: 151.2090, pri: "pref", major: true, mode: "train", travel: { transit: 25, walk: 10 }, src: { label: "Sydney.com", url: "https://www.sydney.com/" }, verify: "unverified", cost: { cat: "transport", amount: 20, unit: "pp", status: "estimate", note: "機場線含站費估計" } },
        { id: "a27", time: "17:30", dur: 120, name: "雪梨歌劇院與港灣大橋夜景", en: "Sydney Opera House & Harbour Bridge", lat: -33.8568, lng: 151.2153, pri: "must", major: true, mode: "walk", travel: { walk: 15 }, src: { label: "Sydney Opera House", url: "https://www.sydneyoperahouse.com/" }, verify: "unverified" }
      ]
    },
    {
      date: "2026-11-04", seg: "syd", title: "曼利渡輪與邦迪海岸步道", stay: "syd", driveHrs: 0, ferry: true,
      items: [
        { id: "a28", time: "09:30", dur: 180, name: "搭渡輪到 Manly 曼利海灘", en: "Manly Ferry & Manly Beach", lat: -33.7969, lng: 151.2850, pri: "pref", major: true, mode: "ferry", travel: { walk: 10, wait: 10, ferry: 30 }, src: { label: "Transport for NSW", url: "https://transportnsw.info/" }, verify: "unverified", cost: { cat: "transport", amount: 20, unit: "pp", status: "estimate", note: "Opal 每日上限內估計" } },
        { id: "a29", time: "14:00", dur: 180, name: "Bondi → Coogee 海岸步道", en: "Bondi to Coogee Coastal Walk", lat: -33.8908, lng: 151.2743, pri: "must", major: true, mode: "bus", travel: { ferry: 30, transit: 35, wait: 10 }, src: { label: "Sydney.com", url: "https://www.sydney.com/" }, verify: "unverified", note: "約 6 公里，注意防曬" }
      ]
    },
    {
      date: "2026-11-05", seg: "syd", title: "藍山一日遊", stay: "syd", driveHrs: 0, hike: true,
      items: [
        { id: "a30", time: "08:00", dur: 120, name: "搭火車往 Katoomba", en: "Train to Katoomba", lat: -33.7120, lng: 150.3110, pri: "must", major: false, mode: "train", travel: { transit: 120, wait: 10 }, src: { label: "Transport for NSW", url: "https://transportnsw.info/" }, verify: "unverified", cost: { cat: "transport", amount: 18, unit: "pp", status: "estimate", note: "Opal 來回估計" } },
        { id: "a31", time: "10:30", dur: 90, name: "Echo Point 三姊妹岩", en: "Echo Point – Three Sisters", lat: -33.7320, lng: 150.3120, pri: "must", major: true, mode: "bus", travel: { transit: 10, walk: 10 }, src: { label: "NSW National Parks", url: "https://www.nationalparks.nsw.gov.au/" }, verify: "unverified" },
        { id: "a32", time: "13:00", dur: 150, name: "Scenic World 纜車", en: "Scenic World", lat: -33.7290, lng: 150.3000, pri: "repl", major: true, mode: "walk", travel: { walk: 30 }, src: { label: "Scenic World", url: "https://www.scenicworld.com.au/" }, verify: "unverified", cost: { cat: "tickets", amount: 55, unit: "pp", status: "estimate" } }
      ]
    },
    {
      date: "2026-11-06", seg: "syd", title: "飛回荷巴特", stay: "utas", driveHrs: 0,
      items: [
        { id: "a33", time: "09:30", dur: 120, name: "達令港早午餐", en: "Darling Harbour", lat: -33.8730, lng: 151.1990, pri: "repl", major: true, mode: "walk", travel: { walk: 15 }, src: { label: "Sydney.com", url: "https://www.sydney.com/" }, verify: "unverified" },
        { id: "a34", time: "15:00", dur: 100, name: "雪梨 → 荷巴特 航班", en: "Flight SYD → HBA", lat: -42.8361, lng: 147.5100, pri: "must", major: false, mode: "flight", travel: { transit: 25, wait: 90, flight: 100 }, src: { label: "Hobart Airport", url: "https://hobartairport.com.au/" }, verify: "unverified", note: "航班與時間待訂", cost: { cat: "transport", amount: 180, unit: "pp", status: "estimate", note: "單程經濟艙＋機場交通估計" } }
      ]
    },
    {
      date: "2026-11-07", seg: "tas", title: "薩拉曼卡市集", stay: "utas", driveHrs: 0,
      items: [
        { id: "a35", time: "09:00", dur: 180, name: "Salamanca Market 週六市集", en: "Salamanca Market", lat: -42.8870, lng: 147.3310, pri: "must", major: true, mode: "walk", travel: { walk: 10 }, src: { label: "Salamanca Market", url: "https://www.salamancamarket.com.au/" }, verify: "unverified", note: "僅週六舉行" }
      ]
    },
    {
      date: "2026-11-08", seg: "tas", title: "Huon Valley 與 Tahune 樹頂步道", stay: "utas", needsDriver: "JJ", driveHrs: 3,
      alt: "若無人開車：改為 Farm Gate Market（週日，步行可達）與市區休息。",
      items: [
        { id: "a36", time: "10:00", dur: 90, name: "Huonville 蘋果農場與小鎮", en: "Huonville", lat: -43.0310, lng: 147.0480, pri: "repl", major: true, mode: "drive", travel: { drive: 40 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" },
        { id: "a37", time: "12:30", dur: 150, name: "Tahune 樹頂步道", en: "Tahune Airwalk", lat: -43.1000, lng: 146.7300, pri: "pref", major: true, mode: "drive", travel: { drive: 50 }, src: { label: "Tahune Adventures", url: "https://www.tahuneadventures.com.au/" }, verify: "unverified", note: "營運狀態與票價請出發前確認", cost: { cat: "tickets", amount: 35, unit: "pp", status: "estimate" } }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 50, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-09", seg: "tas", title: "東海岸：Freycinet 酒杯灣", stay: "coles", needsDriver: "Zayden", driveHrs: 3, transfer: true, hike: true,
      alt: "若無人開車：Tassielink 等長途巴士可到 Bicheno／Coles Bay 一帶但班次少；或改報東海岸多日遊團。",
      items: [
        { id: "a38", time: "08:00", dur: 30, name: "Spiky Bridge 與 Swansea 休息", en: "Swansea", lat: -42.1230, lng: 148.0740, pri: "repl", major: false, mode: "drive", travel: { drive: 135 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" },
        { id: "a39", time: "11:30", dur: 180, name: "Wineglass Bay 酒杯灣觀景台步道", en: "Wineglass Bay Lookout", lat: -42.1500, lng: 148.3000, pri: "must", major: true, mode: "drive", travel: { drive: 45, walk: 45 }, src: { label: "Freycinet National Park", url: "https://parks.tas.gov.au/explore-our-parks/freycinet-national-park" }, verify: "unverified", note: "使用國家公園通行證" },
        { id: "a40", time: "16:00", dur: 60, name: "Honeymoon Bay 夕陽", en: "Honeymoon Bay", lat: -42.1340, lng: 148.3040, pri: "repl", major: true, mode: "drive", travel: { drive: 10 }, src: { label: "Freycinet National Park", url: "https://parks.tas.gov.au/explore-our-parks/freycinet-national-park" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 60, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-10", seg: "tas", title: "火焰灣 → 朗塞斯頓", stay: "lst", needsDriver: "Zayden", driveHrs: 4, transfer: true,
      alt: "若無人開車：此段無方便大眾運輸，建議整趟東海岸改報團或延後。",
      items: [
        { id: "a41", time: "09:00", dur: 150, name: "Bay of Fires 火焰灣（Binalong Bay）", en: "Bay of Fires", lat: -41.2500, lng: 148.3100, pri: "pref", major: true, mode: "drive", travel: { drive: 120 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" },
        { id: "a42", time: "16:00", dur: 60, name: "抵達 Launceston 入住", en: "Launceston", lat: -41.4370, lng: 147.1380, pri: "pref", major: false, mode: "drive", travel: { drive: 150 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 70, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-11", seg: "tas", title: "卡塔拉克特峽谷・回荷巴特", stay: "utas", needsDriver: "Zayden", driveHrs: 2.5, transfer: true,
      alt: "若無人開車：Launceston → Hobart 有長途巴士（Redline / Tassielink），需確認班次。",
      items: [
        { id: "a43", time: "09:00", dur: 150, name: "Cataract Gorge 卡塔拉克特峽谷", en: "Cataract Gorge Reserve", lat: -41.4440, lng: 147.1220, pri: "must", major: true, mode: "drive", travel: { drive: 10 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified", note: "吊椅纜車另計" },
        { id: "a44", time: "13:00", dur: 60, name: "Ross 小鎮麵包店（中途休息）", en: "Ross Village Bakery", lat: -42.0300, lng: 147.4920, pri: "repl", major: false, mode: "drive", travel: { drive: 70 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 55, unit: "shared", participants: 3, status: "estimate" }]
    },
    { date: "2026-11-12", seg: "tas", title: "休息日", stay: "utas", driveHrs: 0, items: [], open: true },
    { date: "2026-11-13", seg: "tas", title: "自由日（待規劃）", stay: "utas", driveHrs: 0, items: [], open: true },
    {
      date: "2026-11-14", seg: "tas", title: "瑪麗亞島", stay: "utas", needsDriver: "JJ", driveHrs: 2.5, ferry: true, hike: true,
      alt: "若無人開車：有從荷巴特出發的瑪麗亞島套裝行程；或改為市區步行日。",
      items: [
        { id: "a45", time: "09:00", dur: 45, name: "Triabunna 搭渡輪", en: "Maria Island Ferry, Triabunna", lat: -42.5090, lng: 147.9120, pri: "must", major: false, mode: "drive", travel: { drive: 75, wait: 20, ferry: 30 }, src: { label: "Encounter Maria Island", url: "https://www.encountermaria.com.au/" }, verify: "unverified", cost: { cat: "transport", amount: 55, unit: "pp", status: "estimate", note: "來回船票估計" } },
        { id: "a46", time: "10:30", dur: 120, name: "Darlington 遺址與袋熊", en: "Darlington & wombats", lat: -42.5800, lng: 148.0650, pri: "must", major: true, mode: "walk", travel: { walk: 10 }, src: { label: "Maria Island National Park", url: "https://parks.tas.gov.au/explore-our-parks/maria-island-national-park" }, verify: "unverified" },
        { id: "a47", time: "13:00", dur: 150, name: "Painted Cliffs 彩繪懸崖", en: "Painted Cliffs", lat: -42.5960, lng: 148.0720, pri: "pref", major: true, mode: "walk", travel: { walk: 40 }, src: { label: "Maria Island National Park", url: "https://parks.tas.gov.au/explore-our-parks/maria-island-national-park" }, verify: "unverified", note: "最佳在退潮時段，請查潮汐" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 45, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-15", seg: "tas", title: "Kingston Beach 輕鬆日", stay: "utas", driveHrs: 0,
      items: [
        { id: "a48", time: "11:00", dur: 150, name: "Kingston Beach 海灘散步", en: "Kingston Beach", lat: -42.9800, lng: 147.3200, pri: "repl", major: true, mode: "bus", travel: { transit: 30, wait: 10 }, src: { label: "Metro Tasmania", url: "https://www.metrotas.com.au/" }, verify: "unverified", cost: { cat: "transport", amount: 7, unit: "pp", status: "estimate", note: "公車來回" } }
      ]
    },
    {
      date: "2026-11-16", seg: "tas", title: "前往搖籃山", stay: "cradle", needsDriver: "Zayden", driveHrs: 4.5, transfer: true,
      alt: "若無人開車：可搭巴士到 Launceston 後接搖籃山接駁或參加多日遊團（需另訂）。",
      items: [
        { id: "a49", time: "09:00", dur: 60, name: "Mole Creek 或 Sheffield 壁畫小鎮（中途）", en: "Sheffield", lat: -41.3830, lng: 146.3260, pri: "repl", major: true, mode: "drive", travel: { drive: 200 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" },
        { id: "a50", time: "15:30", dur: 90, name: "搖籃山遊客中心・Enchanted Walk", en: "Cradle Mountain Visitor Centre", lat: -41.5930, lng: 145.9300, pri: "pref", major: true, mode: "drive", travel: { drive: 60 }, src: { label: "Cradle Mountain", url: "https://parks.tas.gov.au/explore-our-parks/cradle-mountain" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 75, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-17", seg: "tas", title: "鴿子湖環湖步道", stay: "cradle", needsDriver: "Zayden", driveHrs: 0.5, hike: true,
      alt: "此日在山區以園區接駁巴士移動，司機需求較低。",
      items: [
        { id: "a51", time: "09:00", dur: 180, name: "Dove Lake 鴿子湖環湖步道", en: "Dove Lake Circuit", lat: -41.6600, lng: 145.9590, pri: "must", major: true, mode: "bus", travel: { transit: 20, wait: 10 }, src: { label: "Cradle Mountain", url: "https://parks.tas.gov.au/explore-our-parks/cradle-mountain" }, verify: "unverified", note: "約 6 公里；天氣變化快" },
        { id: "a52", time: "14:00", dur: 90, name: "Devils@Cradle 袋獾保育中心", en: "Devils@Cradle", lat: -41.5890, lng: 145.9380, pri: "pref", major: true, mode: "bus", travel: { transit: 15 }, src: { label: "Devils@Cradle", url: "https://www.devilsatcradle.com/" }, verify: "unverified", cost: { cat: "tickets", amount: 35, unit: "pp", status: "estimate" } }
      ]
    },
    {
      date: "2026-11-18", seg: "tas", title: "返回荷巴特", stay: "utas", needsDriver: "Zayden", driveHrs: 4.5, transfer: true,
      alt: "若無人開車：改搭長途巴士經 Launceston 回荷巴特。",
      items: [
        { id: "a53", time: "13:00", dur: 60, name: "Bothwell 或 Oatlands 中途休息", en: "Oatlands", lat: -42.3000, lng: 147.3700, pri: "repl", major: false, mode: "drive", travel: { drive: 210 }, src: { label: "Discover Tasmania", url: "https://www.discovertasmania.com.au/" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 75, unit: "shared", participants: 3, status: "estimate" }]
    },
    { date: "2026-11-19", seg: "tas", title: "休息日", stay: "utas", driveHrs: 0, items: [], open: true },
    { date: "2026-11-20", seg: "tas", title: "自由日（待規劃）", stay: "utas", driveHrs: 0, items: [], open: true },
    {
      date: "2026-11-21", seg: "tas", title: "Hastings 鐘乳石洞與溫泉", stay: "utas", needsDriver: "JJ", driveHrs: 4,
      alt: "若無人開車：改為市區行程；此地點無方便大眾運輸。",
      items: [
        { id: "a54", time: "10:30", dur: 120, name: "Hastings Caves 鐘乳石洞導覽", en: "Hastings Caves State Reserve", lat: -43.4100, lng: 146.8540, pri: "pref", major: true, mode: "drive", travel: { drive: 110 }, src: { label: "Hastings Caves", url: "https://parks.tas.gov.au/explore-our-parks/hastings-caves-state-reserve" }, verify: "unverified", cost: { cat: "tickets", amount: 30, unit: "pp", status: "estimate" } },
        { id: "a55", time: "13:00", dur: 60, name: "溫泉池", en: "Hastings Thermal Springs", lat: -43.4060, lng: 146.8580, pri: "repl", major: true, mode: "walk", travel: { walk: 10 }, src: { label: "Hastings Caves", url: "https://parks.tas.gov.au/explore-our-parks/hastings-caves-state-reserve" }, verify: "unverified" }
      ],
      costs: [{ cat: "transport", label: "油資（共乘）", amount: 60, unit: "shared", participants: 3, status: "estimate" }]
    },
    {
      date: "2026-11-22", seg: "tas", title: "Farm Gate 農夫市集", stay: "utas", driveHrs: 0,
      items: [
        { id: "a56", time: "09:00", dur: 120, name: "Farm Gate Market 週日農夫市集", en: "Farm Gate Market", lat: -42.8820, lng: 147.3260, pri: "pref", major: true, mode: "walk", travel: { walk: 5 }, src: { label: "Farm Gate Market", url: "https://farmgatemarket.com.au/" }, verify: "unverified", note: "僅週日舉行" }
      ]
    },
    { date: "2026-11-23", seg: "tas", title: "自由日（待規劃）", stay: "utas", driveHrs: 0, items: [], open: true },
    { date: "2026-11-24", seg: "tas", title: "自由日（待規劃）", stay: "utas", driveHrs: 0, items: [], open: true },
    { date: "2026-11-25", seg: "tas", title: "整理行李・紀念品", stay: "utas", driveHrs: 0, items: [], open: true },
    {
      date: "2026-11-26", seg: "tas", title: "離開塔斯馬尼亞", stay: "none", driveHrs: 0.5,
      items: [
        { id: "a57", time: "10:00", dur: 60, name: "前往荷巴特機場", en: "Hobart Airport", lat: -42.8361, lng: 147.5100, pri: "must", major: false, mode: "bus", travel: { transit: 30, wait: 15 }, src: { label: "Hobart Airport", url: "https://hobartairport.com.au/" }, verify: "unverified", note: "航班時間待填", cost: { cat: "transport", amount: 22, unit: "pp", status: "estimate" } }
      ]
    }
  ]
};
