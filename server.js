require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function createHttpError(statusCode, message, detail = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
}

const marketplaces = [
  {
    name: "Amazon",
    host: "amazon",
    tone: "Prime delivery, easy replacement, stable stock",
    base: 900,
    discount: 18
  },
  {
    name: "Flipkart",
    host: "flipkart",
    tone: "Bank offers, exchange bonus, fast Indian delivery",
    base: 700,
    discount: 24
  },
  {
    name: "Shopify Store",
    host: "shopify",
    tone: "Brand-store coupon, limited time promotional discount",
    base: 950,
    discount: 50
  },
  {
    name: "Myntra",
    host: "myntra",
    tone: "Fashion-focused seller, seasonal sale pricing",
    base: 840,
    discount: 15
  }
];

function detectPlatform(input) {
  const value = input.toLowerCase();
  const found = marketplaces.find((market) => value.includes(market.host));
  return found ? found.name : "Submitted store";
}

function isValidHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function extractProductName(input) {
  try {
    const url = new URL(input);
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => part.replace(/[-_]+/g, " "))
      .filter((part) => !/^(dp|gp|itm|p|product|buy|s|b|a)$/i.test(part));

    const readable = parts.find((part) => part.length > 4);
    if (readable) {
      return titleCase(readable.slice(0, 64));
    }
  } catch (error) {
    return titleCase(input.slice(0, 64) || "Product X");
  }

  return "Product X";
}

function cleanText(value = "") {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getMetaContent(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return "";
}

function parsePrice(value = "") {
  const normalizedValue = value.replace(/\u20b9/g, "₹").replace(/â‚¹/g, "₹");
  const match = normalizedValue
    .replace(/,/g, "")
    .match(/(?:rs\.?|inr|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)|^([0-9]+(?:\.[0-9]{1,2})?)$/i);
  return match ? Math.round(Number(match[1] || match[2])) : null;
}

async function fetchProductSnapshot(productUrl) {
  const fallback = {
    title: extractProductName(productUrl),
    price: null,
    image: "",
    description: "",
    source: detectPlatform(productUrl),
    fetched: false,
    warning: ""
  };

  try {
    new URL(productUrl);
  } catch (error) {
    return {
      ...fallback,
      title: extractProductName(productUrl),
      warning: "Input was treated as a product name because it was not a valid URL."
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(productUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9"
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        ...fallback,
        warning: `The store returned HTTP ${response.status}, so live details may be limited.`
      };
    }

    const html = await response.text();
    const title =
      getMetaContent(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i,
        /<title[^>]*>([\s\S]*?)<\/title>/i
      ]) || fallback.title;
    const description = getMetaContent(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ]);
    const image = getMetaContent(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
    ]);
    const priceText =
      getMetaContent(html, [
        /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+name=["']price["'][^>]+content=["']([^"']+)["']/i
      ]) || cleanText(html).slice(0, 5000);

    return {
      title: title.replace(/\s*[:|-]\s*(Amazon|Flipkart|Myntra).*$/i, "").slice(0, 120),
      price: parsePrice(priceText),
      image,
      description: description.slice(0, 240),
      source: detectPlatform(productUrl),
      fetched: true,
      warning: ""
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ...fallback,
      warning:
        "The product page could not be fetched from the server. Some ecommerce sites block automated requests."
    };
  }
}

function titleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function seededNumber(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getOpenAIKey() {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  return key && key !== "your_openai_api_key_here" ? key : "";
}

function getOpenAIOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const textParts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function getOpenAISources(data) {
  const sources = [];

  for (const item of data.output || []) {
    if (Array.isArray(item.sources)) {
      sources.push(...item.sources);
    }

    if (item.type === "web_search_call" && Array.isArray(item.action?.sources)) {
      sources.push(...item.action.sources);
    }
  }

  return sources
    .map((source) => ({
      title: String(source.title || source.url || "Web source").slice(0, 120),
      url: String(source.url || "")
    }))
    .filter((source) => isValidHttpUrl(source.url))
    .slice(0, 8);
}

function buildUnavailableAdvice(reason) {
  return {
    usedAI: false,
    statusLabel: "Live AI search unavailable",
    error: reason,
    verdict: "Live product comparison could not run.",
    summary:
      "Add a valid OpenAI API key and use a model/account that supports Responses API web search to find current prices across platforms.",
    reasons: [
      "Current cross-store prices require live web search.",
      "The app no longer fabricates marketplace prices.",
      "Submitted product details are still shown when the page can be scanned."
    ],
    checks: ["Set OPENAI_API_KEY in .env.", "Restart the server.", "Paste a public product URL or product name."]
  };
}

function normalizeAdvice(ai, comparison) {
  const fallback = buildUnavailableAdvice(ai?.error || "AI analysis was not available.");

  return {
    usedAI: Boolean(ai?.usedAI),
    statusLabel: ai?.statusLabel || fallback.statusLabel,
    error: ai?.error || "",
    verdict: ai?.verdict || fallback.verdict,
    summary: ai?.summary || fallback.summary,
    reasons: Array.isArray(ai?.reasons) && ai.reasons.length ? ai.reasons : fallback.reasons,
    checks: Array.isArray(ai?.checks) && ai.checks.length ? ai.checks : fallback.checks,
    sources: Array.isArray(ai?.sources) ? ai.sources : []
  };
}

function buildFallbackComparison(productUrl, snapshot, reason) {
  const productName = snapshot.title || extractProductName(productUrl);
  const submittedPlatform = detectPlatform(productUrl);
  const submittedUrlIsValid = isValidHttpUrl(productUrl);
  const submittedPrice = Number.isFinite(snapshot.price) ? snapshot.price : 0;
  const submittedOffer = {
    name: submittedPlatform,
    platform: submittedPlatform,
    host: submittedPlatform.toLowerCase(),
    tone: snapshot.description || reason,
    discount: 0,
    isSubmitted: true,
    listedPrice: submittedPrice,
    salePrice: submittedPrice,
    savings: 0,
    availability: snapshot.price ? "Submitted page price" : "Price not visible",
    link: submittedUrlIsValid
      ? productUrl
      : `https://www.google.com/search?q=${encodeURIComponent(productName)}`,
    verified: snapshot.fetched,
    priceText: snapshot.price ? formatCurrency(snapshot.price) : "Price not found"
  };

  return {
    productName,
    snapshot,
    productLink: submittedUrlIsValid
      ? productUrl
      : `https://www.google.com/search?q=${encodeURIComponent(productName)}`,
    productLinkLabel: submittedUrlIsValid ? "Open submitted product" : "Search product",
    submittedPlatform,
    best: submittedOffer,
    submitted: submittedOffer,
    offers: [submittedOffer],
    spread: 0,
    confidence: snapshot.fetched ? 55 : 25
  };
}

function normalizeOffer(rawOffer, productUrl, snapshot, index, submittedPrice) {
  const price = Number(rawOffer?.price);
  const salePrice = Number.isFinite(price) && price > 0 ? Math.round(price) : 0;
  const platform = String(rawOffer?.platform || rawOffer?.name || `Result ${index + 1}`).trim();
  const link = isValidHttpUrl(rawOffer?.link || "") ? rawOffer.link : "";
  const isSubmitted = Boolean(link && isValidHttpUrl(productUrl) && link === productUrl);

  return {
    name: platform,
    platform,
    host: platform.toLowerCase(),
    tone: String(rawOffer?.notes || rawOffer?.availability || "AI found this candidate from live web search.").slice(0, 180),
    discount: 0,
    isSubmitted,
    listedPrice: salePrice,
    salePrice,
    savings: submittedPrice && salePrice ? Math.max(0, submittedPrice - salePrice) : 0,
    availability: String(rawOffer?.availability || "Check seller page").slice(0, 90),
    link: link || `https://www.google.com/search?q=${encodeURIComponent(`${snapshot.title || extractProductName(productUrl)} ${platform}`)}`,
    verified: Boolean(link),
    priceText: rawOffer?.priceText || (salePrice ? formatCurrency(salePrice) : "Price not found")
  };
}

function buildComparisonFromAI(productUrl, snapshot, parsed) {
  const productName = parsed.productName || snapshot.title || extractProductName(productUrl);
  const submittedUrlIsValid = isValidHttpUrl(productUrl);
  const submittedPlatform = detectPlatform(productUrl);
  const submittedPrice = Number.isFinite(snapshot.price) ? snapshot.price : 0;
  const rawOffers = Array.isArray(parsed.offers) ? parsed.offers : [];
  const offers = rawOffers
    .map((offer, index) => normalizeOffer(offer, productUrl, snapshot, index, submittedPrice))
    .filter((offer) => offer.name && offer.link);

  if (submittedUrlIsValid && !offers.some((offer) => offer.link === productUrl)) {
    offers.push({
      name: submittedPlatform,
      platform: submittedPlatform,
      host: submittedPlatform.toLowerCase(),
      tone: snapshot.description || "Original pasted product page.",
      discount: 0,
      isSubmitted: true,
      listedPrice: submittedPrice,
      salePrice: submittedPrice,
      savings: 0,
      availability: snapshot.price ? "Submitted page price" : "Price not visible",
      link: productUrl,
      verified: snapshot.fetched,
      priceText: snapshot.price ? formatCurrency(snapshot.price) : "Price not found"
    });
  }

  offers.sort((a, b) => {
    if (!a.salePrice) return 1;
    if (!b.salePrice) return -1;
    return a.salePrice - b.salePrice;
  });

  const best = offers.find((offer) => offer.salePrice > 0) || offers[0];
  const submitted = offers.find((offer) => offer.isSubmitted) || offers[0];
  const pricedOffers = offers.filter((offer) => offer.salePrice > 0);
  const highest = pricedOffers[pricedOffers.length - 1] || best;

  return {
    productName,
    snapshot,
    productLink: submittedUrlIsValid
      ? productUrl
      : `https://www.google.com/search?q=${encodeURIComponent(productName)}`,
    productLinkLabel: submittedUrlIsValid ? "Open submitted product" : "Search product",
    submittedPlatform,
    best,
    submitted,
    offers,
    spread: best && highest ? Math.max(0, highest.salePrice - best.salePrice) : 0,
    confidence: Math.max(50, Math.min(96, Number(parsed.confidence) || 78))
  };
}

async function analyzeLiveProduct(productUrl, snapshot) {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    const comparison = buildFallbackComparison(
      productUrl,
      snapshot,
      "Missing OPENAI_API_KEY. Create a .env file in the project root and add your key there."
    );
    return {
      comparison,
      ai: normalizeAdvice(buildUnavailableAdvice("Missing OPENAI_API_KEY. Create a .env file in the project root and add your key there."), comparison)
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        store: false,
        tools: [
          {
            type: "web_search",
            user_location: {
              type: "approximate",
              country: "IN",
              timezone: "Asia/Kolkata"
            }
          }
        ],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
        instructions:
          "You are a careful ecommerce price comparison agent for Indian shoppers. Use live web search to find the same exact product across marketplaces. Prefer direct product pages over category/search pages. Return JSON only. Do not invent prices or links. If a price is not visible, omit that offer or set price to 0 and explain in notes. Prices must be visible on the linked source or clearly marked unavailable.",
        input: `Pasted product URL or name: ${productUrl}
Submitted page snapshot: ${JSON.stringify(snapshot)}

Find the same product at the lowest currently visible price across ecommerce platforms such as Amazon, Flipkart, Myntra, Croma, Reliance Digital, Tata Cliq, Ajio, brand stores, and other credible sellers. Compare only likely same-product matches. Include direct product links and current visible prices.`,
        text: {
          format: {
            type: "json_schema",
            name: "live_product_comparison",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                productName: { type: "string" },
                verdict: { type: "string" },
                summary: { type: "string" },
                confidence: { type: "number" },
                offers: {
                  type: "array",
                  minItems: 1,
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      platform: { type: "string" },
                      price: { type: "number" },
                      priceText: { type: "string" },
                      link: { type: "string" },
                      availability: { type: "string" },
                      notes: { type: "string" }
                    },
                    required: ["platform", "price", "priceText", "link", "availability", "notes"]
                  }
                },
                reasons: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 3,
                  maxItems: 4
                },
                checks: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 2,
                  maxItems: 4
                }
              },
              required: ["productName", "verdict", "summary", "confidence", "offers", "reasons", "checks"]
            }
          }
        },
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message = errorBody.error?.message || `OpenAI returned HTTP ${response.status}`;
      throw new Error(message);
    }

    const data = await response.json();
    const outputText = getOpenAIOutputText(data);
    if (!outputText) {
      throw new Error("OpenAI returned an empty response.");
    }

    const parsed = JSON.parse(outputText);
    const comparison = buildComparisonFromAI(productUrl, snapshot, parsed);
    const sources = getOpenAISources(data);

    const ai = normalizeAdvice({
      usedAI: true,
      statusLabel: "Live AI web search",
      error: "",
      verdict: parsed.verdict,
      summary: parsed.summary,
      reasons: parsed.reasons,
      checks: parsed.checks,
      sources
    }, comparison);

    return { comparison, ai };
  } catch (error) {
    const comparison = buildFallbackComparison(productUrl, snapshot, `OpenAI live search failed: ${error.message}`);
    return {
      comparison,
      ai: normalizeAdvice(buildUnavailableAdvice(`OpenAI live search failed: ${error.message}`), comparison)
    };
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Math.max(0, value));
}

function formatPrice(value, fallback = "Price not found") {
  return Number.isFinite(value) && value > 0 ? formatCurrency(value) : fallback;
}

app.locals.formatCurrency = formatCurrency;
app.locals.formatPrice = formatPrice;

app.get("/", (req, res) => {
  res.render("index", { error: null });
});

app.post("/analyze", async (req, res) => {
  try {
    const productUrl = (req.body.productUrl || "").trim();

    if (!productUrl) {
      return res.status(400).render("index", {
        error: "Paste a product link or product name to compare prices."
      });
    }

    if (productUrl.length > 600) {
      throw createHttpError(
        400,
        "That product input is too long.",
        "Paste a direct product link or a shorter product name under 600 characters."
      );
    }

    const snapshot = await fetchProductSnapshot(productUrl);
    const { comparison, ai } = await analyzeLiveProduct(productUrl, snapshot);

    return res.render("result", {
      productUrl,
      comparison,
      ai
    });
  } catch (error) {
    return renderError(res, error);
  }
});

app.use((req, res) => {
  renderError(
    res,
    createHttpError(
      404,
      "Page not found.",
      "The page you requested does not exist. Start a new product analysis from the home page."
    )
  );
});

app.use((error, req, res, next) => {
  renderError(res, error);
});

function renderError(res, error) {
  const statusCode = Number(error.statusCode) || 500;
  const isServerError = statusCode >= 500;

  console.error(`[DealLens] ${statusCode}: ${error.message}`);

  return res.status(statusCode).render("error", {
    statusCode,
    title: isServerError ? "Something went wrong." : error.message,
    message: isServerError
      ? "DealLens could not finish the analysis. Please try again with a shorter product link or product name."
      : error.message,
    detail: error.detail || (isServerError ? "The server caught the problem and kept the app running." : "")
  });
}

app.listen(PORT, () => {
  console.log(`DealLens running at http://localhost:${PORT}`);
});
