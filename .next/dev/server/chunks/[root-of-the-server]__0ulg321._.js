module.exports = [
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:child_process [external] (node:child_process, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:child_process", () => require("node:child_process"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[externals]/node:util [external] (node:util, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:util", () => require("node:util"));

module.exports = mod;
}),
"[project]/app/api/traders/[address]/positions/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/connect.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/SimPosition.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$positionsView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/simulation/positionsView.js [app-route] (ecmascript)");
;
;
;
;
async function GET(request, { params }) {
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["connectDb"])();
    const { address } = await params;
    const status = request.nextUrl.searchParams.get("status");
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "25")));
    const filter = {
        traderAddress: address
    };
    if (status === "open" || status === "closed") filter.status = status;
    const sortField = status === "open" ? "openedAt" : "closedAt";
    const [rawPositions, total] = await Promise.all([
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SimPosition"].find(filter).sort({
            [sortField]: -1
        }).skip((page - 1) * limit).limit(limit).lean(),
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SimPosition"].countDocuments(filter)
    ]);
    const positions = status === "open" ? await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$positionsView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["markOpenPositions"])(rawPositions) : rawPositions;
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        positions,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
    });
}
}),
"[project]/db/connect.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "connectDb",
    ()=>connectDb
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
let cached = /*TURBOPACK member replacement*/ __turbopack_context__.g.__mongooseConnection;
if (!cached) {
    cached = /*TURBOPACK member replacement*/ __turbopack_context__.g.__mongooseConnection = {
        conn: null,
        promise: null
    };
}
async function connectDb() {
    if (cached.conn) return cached.conn;
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set (check your .env file)");
    if (!cached.promise) {
        cached.promise = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"].connect(uri, {
            bufferCommands: false
        }).then((m)=>m);
    }
    cached.conn = await cached.promise;
    return cached.conn;
}
}),
"[project]/db/models/SimPosition.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SimPosition",
    ()=>SimPosition
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
/**
 * One simulated copy-trade position for a (trader, mint) pair. Doubles as
 * the "open positions" and "closed trades" data - status flips from "open"
 * to "closed" in place, nothing is deleted, so this is also the trader's
 * full simulated trade history.
 */ const SimPositionSchema = new Schema({
    traderAddress: {
        type: String,
        required: true,
        index: true
    },
    mint: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: [
            "open",
            "closed"
        ],
        default: "open",
        index: true
    },
    // Buy side
    tokenAmount: {
        type: Number,
        required: true
    },
    costBasisUsd: {
        type: Number,
        required: true
    },
    buyFeeUsd: {
        type: Number,
        required: true
    },
    buyPriceUsd: {
        type: Number,
        required: true
    },
    openedAt: {
        type: Date,
        default: Date.now
    },
    openTriggerSignature: {
        type: String,
        required: true
    },
    // Set once unrealized gain first reaches the trader's benchCapPercent -
    // arms the "back to entry" auto-sell (see db/simulation/executor.js).
    benchArmed: {
        type: Boolean,
        default: false
    },
    // Peak (max favorable excursion) reached at any point while open, sampled
    // on the risk-check interval - answers "it eventually closed at +40%, but
    // how high did it actually go before coming back down?" These three are
    // always derived from the SAME observed peak moment (maxValueUsd is the
    // canonical one; the $/% profit fields are just that value minus the
    // fixed cost basis, computed once and stored for convenient display).
    maxValueUsd: {
        type: Number,
        required: true
    },
    maxUnrealizedPnlUsd: {
        type: Number,
        required: true
    },
    maxUnrealizedPnlPercent: {
        type: Number,
        required: true
    },
    // Sell side (set when closed)
    closedAt: {
        type: Date,
        default: null
    },
    closeReason: {
        type: String,
        enum: [
            "trader_sell",
            "stop_loss",
            "take_profit",
            "bench",
            null
        ],
        default: null
    },
    closeTriggerSignature: {
        type: String,
        default: null
    },
    sellPriceUsd: {
        type: Number,
        default: null
    },
    proceedsUsd: {
        type: Number,
        default: null
    },
    sellFeeUsd: {
        type: Number,
        default: null
    },
    realizedPnlUsd: {
        type: Number,
        default: null
    },
    realizedPnlPercent: {
        type: Number,
        default: null
    }
});
SimPositionSchema.index({
    traderAddress: 1,
    status: 1
});
SimPositionSchema.index({
    traderAddress: 1,
    closedAt: -1
});
// Ultimate DB-level backstop for "never buy the same mint twice for a
// trader": it is structurally impossible to have two *open* positions for
// the same (trader, mint) at once, regardless of any race above this layer.
// (This also serves as the general traderAddress+mint lookup index - every
// query against that key pair in this codebase filters to status:"open"
// anyway, so a separate unfiltered {traderAddress,mint} index would just be
// a duplicate key pattern - Mongoose warns about and skips those.)
SimPositionSchema.index({
    traderAddress: 1,
    mint: 1
}, {
    unique: true,
    partialFilterExpression: {
        status: "open"
    }
});
const SimPosition = models.SimPosition || model("SimPosition", SimPositionSchema);
}),
"[project]/db/pumpFunApi.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getCoinInfo",
    ()=>getCoinInfo,
    "markHoldings",
    ()=>markHoldings,
    "priceFromCoinInfo",
    ()=>priceFromCoinInfo
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:child_process [external] (node:child_process, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$util__$5b$external$5d$__$28$node$3a$util$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:util [external] (node:util, cjs)");
;
;
const execFileAsync = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$util__$5b$external$5d$__$28$node$3a$util$2c$__cjs$29$__["promisify"])(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__["execFile"]);
const CACHE_TTL_MS = 15_000;
const cache = new Map(); // mint -> { data, expiresAt }
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const STATUS_MARKER = "\n__HTTP_STATUS__";
/**
 * pump.fun's frontend API blocks Node's own `fetch` (undici) outright -
 * confirmed by testing: plain `curl` gets HTTP 200 reliably (5/5 attempts,
 * with or without extra headers), while Node's `fetch` gets HTTP 403 every
 * single time even with a browser User-Agent set. That's consistent with
 * TLS/HTTP client fingerprinting (e.g. Cloudflare-style bot protection)
 * rather than a header check, since headers alone didn't change Node's
 * result. Shelling out to curl (present by default on Windows 10+ and any
 * Unix box) is the pragmatic fix, since it demonstrably isn't blocked.
 */ async function curlGetJson(url) {
    const { stdout } = await execFileAsync("curl", [
        "-s",
        "-m",
        "10",
        "-w",
        `${STATUS_MARKER}%{http_code}`,
        url
    ]);
    const markerIndex = stdout.lastIndexOf(STATUS_MARKER);
    const body = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
    const status = markerIndex >= 0 ? Number(stdout.slice(markerIndex + STATUS_MARKER.length).trim()) : 0;
    return {
        status,
        body
    };
}
async function getCoinInfo(mint) {
    const cached = cache.get(mint);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const base = process.env.PUMP_FUN_API_BASE || "https://frontend-api-v3.pump.fun";
    const { status, body } = await curlGetJson(`${base}/coins-v3/${mint}`);
    if (status === 404) {
        cache.set(mint, {
            data: null,
            expiresAt: Date.now() + CACHE_TTL_MS
        });
        return null;
    }
    if (status !== 200) throw new Error(`pump.fun API HTTP ${status} for ${mint}`);
    const data = JSON.parse(body);
    cache.set(mint, {
        data,
        expiresAt: Date.now() + CACHE_TTL_MS
    });
    return data;
}
function priceFromCoinInfo(coin) {
    if (!coin) return null;
    const baseDecimals = coin.base_decimals ?? 6;
    const quoteDecimals = coin.quote_decimals ?? 9;
    const priceInQuote = coin.virtual_sol_reserves && coin.virtual_token_reserves ? coin.virtual_sol_reserves / 10 ** quoteDecimals / (coin.virtual_token_reserves / 10 ** baseDecimals) : null;
    const priceUsd = coin.usd_market_cap && coin.total_supply ? coin.usd_market_cap / (coin.total_supply / 10 ** baseDecimals) : null;
    return {
        priceInQuote,
        priceUsd,
        isNativeSolQuote: coin.quote_mint === SYSTEM_PROGRAM_ID,
        marketCapUsd: coin.usd_market_cap ?? null
    };
}
async function markHoldings(holdings) {
    const results = [];
    for (const holding of holdings){
        const coin = await getCoinInfo(holding.mint).catch(()=>null);
        const price = priceFromCoinInfo(coin);
        const currentValueUsd = price?.priceUsd != null ? price.priceUsd * holding.tokenAmount : null;
        results.push({
            ...holding,
            symbol: coin?.symbol ?? null,
            name: coin?.name ?? null,
            priceUsd: price?.priceUsd ?? null,
            currentValueUsd
        });
    }
    return results;
}
}),
"[project]/db/simulation/positionsView.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getMarkedOpenPositions",
    ()=>getMarkedOpenPositions,
    "getUnrealizedPnlUsd",
    ()=>getUnrealizedPnlUsd,
    "markOpenPositions",
    ()=>markOpenPositions
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/SimPosition.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/pumpFunApi.js [app-route] (ecmascript)");
;
;
async function markOpenPositions(positions) {
    return Promise.all(positions.map(async (position)=>{
        const coin = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getCoinInfo"])(position.mint).catch(()=>null);
        const price = (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["priceFromCoinInfo"])(coin);
        const totalCost = position.costBasisUsd + position.buyFeeUsd;
        if (!price?.priceUsd) {
            return {
                ...position,
                currentPriceUsd: null,
                currentValueUsd: null,
                unrealizedPnlUsd: null,
                unrealizedPnlPercent: null
            };
        }
        const currentValueUsd = position.tokenAmount * price.priceUsd;
        const unrealizedPnlUsd = currentValueUsd - totalCost;
        const unrealizedPnlPercent = totalCost > 0 ? unrealizedPnlUsd / totalCost * 100 : 0;
        return {
            ...position,
            currentPriceUsd: price.priceUsd,
            currentValueUsd,
            unrealizedPnlUsd,
            unrealizedPnlPercent
        };
    }));
}
async function getMarkedOpenPositions(traderAddress) {
    const positions = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SimPosition"].find({
        traderAddress,
        status: "open"
    }).lean();
    return markOpenPositions(positions);
}
async function getUnrealizedPnlUsd(traderAddress) {
    const marked = await getMarkedOpenPositions(traderAddress);
    return marked.reduce((sum, p)=>sum + (p.unrealizedPnlUsd || 0), 0);
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0ulg321._.js.map