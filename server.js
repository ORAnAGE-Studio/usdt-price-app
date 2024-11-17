const express = require("express");
const cors = require("cors");
const path = require("path");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = 3000;

// CORS設定
const allowedOrigins = [
  "https://usdt-price-app-web.vercel.app", // 本番環境
  "http://localhost:3000", // ローカル開発環境
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true); // 許可するリクエスト
    } else {
      callback(new Error("Not allowed by CORS")); // 許可しないリクエスト
    }
  },
  methods: ["GET", "POST"], // 許可するHTTPメソッド
  allowedHeaders: ["Content-Type", "Authorization"], // 許可するカスタムヘッダー
}));

// 強制HTTPSリダイレクト（本番環境用）
app.use((req, res, next) => {
  if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

// キャッシュ無効化
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store'); // キャッシュを無効化
  next();
});

// 全取引所リスト
const exchanges = [
  {
    name: "Bithumb",
    country: "Korea",
    currency: "KRW",
    api: "https://api.bithumb.com/public/ticker/USDT",
    parseResponse: (data) => parseFloat(data.data.closing_price),
  },
  {
    name: "Upbit",
    country: "Korea",
    currency: "KRW",
    api: "https://api.upbit.com/v1/ticker?markets=KRW-USDT",
    parseResponse: (data) => data[0].trade_price,
  },
  {
    name: "Coinone",
    country: "Korea",
    currency: "KRW",
    api: "https://api.coinone.co.kr/ticker?currency=usdt",
    parseResponse: (data) => parseFloat(data.last),
  },
  {
    name: "Korbit",
    country: "Korea",
    currency: "KRW",
    api: "https://api.korbit.co.kr/v1/ticker/detailed?currency_pair=usdt_krw",
    parseResponse: (data) => parseFloat(data.last),
  },
  {
    name: "MAX",
    country: "Taiwan",
    currency: "TWD",
    api: "https://max-api.maicoin.com/api/v2/tickers/usdttwd",
    parseResponse: (data) => parseFloat(data.last),
  },
  {
    name: "Binance",
    country: "Vietnam",
    currency: "VND",
    api: "https://api.binance.com/api/v3/ticker/price?symbol=USDTBVND",
    parseResponse: (data) => parseFloat(data.price),
  },
  {
    name: "BitcoinVN",
    country: "Vietnam",
    currency: "VND",
    api: "https://bitcoinvn.io/api/v1/ticker",
    parseResponse: (data) => parseFloat(data.USDT.last), // 仮定
  },
  {
    name: "Mtobit",
    country: "Vietnam",
    currency: "VND",
    api: "https://api.mtobit.com/market/ticker?symbol=USDT",
    parseResponse: (data) => parseFloat(data.ticker.last), // 仮定
  },
];

// Yahoo Financeから個別に為替レートを取得
async function getExchangeRate(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    const rate = data.chart.result[0]?.meta?.regularMarketPrice || null;
    return rate;
  } catch (error) {
    console.error(`Error fetching exchange rate for ${symbol}:`, error.message);
    return null;
  }
}

// 各取引所からUSDT価格を取得し、JPYに換算
async function getUSDTPrices(exchangeRates) {
  const prices = [];

  for (const exchange of exchanges) {
    try {
      const response = await fetch(exchange.api);
      const data = await response.json();

       // デバッグログ: データを確認
       // console.log("Data:", data);

      // 現地価格を取得
      const priceInLocalCurrency = exchange.parseResponse(data);

      // 国ごとに適切な為替レートを選択
      let conversionRate = 1; // デフォルト値
      if (exchange.country === "Korea") {
        conversionRate = exchangeRates.KRWJPY || 1;
      } else if (exchange.country === "Vietnam") {
        conversionRate = exchangeRates.VNDJPY || 1;
      } else if (exchange.country === "Taiwan") {
        conversionRate = exchangeRates.TWDJPY || 1;
      }

      // 円ベースに換算
      const priceInJPY = priceInLocalCurrency * conversionRate;

      // デバッグログ
      // console.log(
      //   `${exchange.name} - Local Price: ${priceInLocalCurrency}, Conversion Rate: ${conversionRate}, JPY Price: ${priceInJPY}`
      // );

      prices.push({
        exchange: exchange.name,
        country: exchange.country,
        localPrice: `${priceInLocalCurrency.toFixed(4)} ${exchange.currency}`,
        priceInJPY: priceInJPY.toFixed(4),
      });
    } catch (error) {
      console.error(`Error fetching data from ${exchange.name}:`, error.message);
      prices.push({
        exchange: exchange.name,
        country: exchange.country,
        localPrice: "N/A",
        priceInJPY: "N/A",
      });
    }
  }

  return prices;
}

// APIエンドポイント
app.get("/api/prices", async (req, res) => {
  try {
    // 為替レートを3回に分けて取得
    const [usdJpyRate, krwJpyRate, vndJpyRate, twdJpyRate] = await Promise.all([
      getExchangeRate("USDJPY=X"),
      getExchangeRate("KRWJPY=X"),
      getExchangeRate("VNDJPY=X"),
      getExchangeRate("TWDJPY=X"),
    ]);

    const exchangeRates = {
      USDJPY: usdJpyRate,
      KRWJPY: krwJpyRate,
      VNDJPY: vndJpyRate,
      TWDJPY: twdJpyRate,
    };

    // デバッグログ: 為替レートを確認
    // console.log("Exchange Rates:", exchangeRates);

    const usdtPrices = await getUSDTPrices(exchangeRates);
    res.json({ exchangeRates, usdtPrices });
  } catch (error) {
    console.error("Error fetching data:", error.message);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Binance APIプロキシ
const BINANCE_API_URL = "https://api.binance.com/api/v3/ticker/price?symbol=USDTBVND";

app.get("/api/binance", async (req, res) => {
  try {
    const response = await fetch(BINANCE_API_URL);
    if (!response.ok) {
      throw new Error(`Binance API Error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching Binance data:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch Binance data" });
  }
});

// フロントエンドのHTMLを提供
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});