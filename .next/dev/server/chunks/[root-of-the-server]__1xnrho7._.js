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
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[project]/app/api/traders/[address]/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "PATCH",
    ()=>PATCH
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/connect.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trader.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/traderService.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$traderView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/traderView.js [app-route] (ecmascript)");
;
;
;
;
;
async function GET(_request, { params }) {
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["connectDb"])();
    const { address } = await params;
    const trader = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address
    });
    if (!trader) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "Trader not found"
    }, {
        status: 404
    });
    const view = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$traderView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveTraderViewWithHoldings"])(trader);
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        trader: view
    });
}
async function PATCH(request, { params }) {
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["connectDb"])();
    const { address } = await params;
    const body = await request.json().catch(()=>({}));
    const existing = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address
    });
    if (!existing) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: "Trader not found"
    }, {
        status: 404
    });
    if (body.status !== undefined) {
        if (![
            "active",
            "blacklisted"
        ].includes(body.status)) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: "status must be 'active' or 'blacklisted'"
            }, {
                status: 400
            });
        }
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["setBlacklisted"])(address, body.status === "blacklisted");
    }
    if (body.muted !== undefined) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["setMuted"])(address, body.muted);
    }
    if (body.label !== undefined || body.notes !== undefined) {
        await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["setTraderMeta"])(address, {
            label: body.label,
            notes: body.notes
        });
    }
    const updated = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address
    });
    const view = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$traderView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveTraderViewWithHoldings"])(updated);
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        trader: view
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
"[project]/db/models/GlobalSettings.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GlobalSettings",
    ()=>GlobalSettings,
    "getGlobalSettings",
    ()=>getGlobalSettings
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
// Singleton document (key is always "global"). Holds the defaults a
// trader falls back to when they don't have their own override set.
const GlobalSettingsSchema = new Schema({
    key: {
        type: String,
        default: "global",
        unique: true
    },
    defaultMuted: {
        type: Boolean,
        default: false
    }
});
const GlobalSettings = models.GlobalSettings || model("GlobalSettings", GlobalSettingsSchema);
async function getGlobalSettings() {
    let settings = await GlobalSettings.findOne({
        key: "global"
    });
    if (!settings) settings = await GlobalSettings.create({
        key: "global"
    });
    return settings;
}
}),
"[project]/db/models/PositionLot.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "PositionLot",
    ()=>PositionLot
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
/**
 * One open FIFO buy lot for a trader+mint. Realized PnL and "current
 * holdings" are both derived from these: a sell consumes the oldest lots
 * first (FIFO), and whatever tokenAmountRemaining is left across all lots
 * for a mint is what the trader is still currently holding.
 */ const PositionLotSchema = new Schema({
    traderAddress: {
        type: String,
        required: true,
        index: true
    },
    mint: {
        type: String,
        required: true,
        index: true
    },
    tokenAmountRemaining: {
        type: Number,
        required: true
    },
    solCostRemaining: {
        type: Number,
        required: true
    },
    openSignature: {
        type: String,
        required: true
    },
    openedAt: {
        type: Date,
        default: Date.now
    }
});
PositionLotSchema.index({
    traderAddress: 1,
    mint: 1,
    openedAt: 1
});
const PositionLot = models.PositionLot || model("PositionLot", PositionLotSchema);
}),
"[project]/db/models/Trade.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Trade",
    ()=>Trade
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
const TradeSchema = new Schema({
    traderAddress: {
        type: String,
        required: true,
        index: true
    },
    signature: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: [
            "buy",
            "sell"
        ],
        required: true
    },
    program: {
        type: String,
        required: true
    },
    mint: {
        type: String,
        required: true,
        index: true
    },
    tokenAmount: {
        type: Number,
        default: null
    },
    solAmount: {
        type: Number,
        default: null
    },
    solAmountSource: {
        type: String,
        default: null
    },
    isNativeSolQuote: {
        type: Boolean,
        default: true
    },
    quoteMint: {
        type: String,
        default: null
    },
    slot: {
        type: Number,
        default: null
    },
    blockTime: {
        type: Number,
        default: null
    },
    recordedAt: {
        type: Date,
        default: Date.now
    }
});
// A given wallet's leg of a given signature/mint/type should only ever be
// recorded once, even if the tracker sees the same notification twice.
TradeSchema.index({
    traderAddress: 1,
    signature: 1,
    mint: 1,
    type: 1
}, {
    unique: true
});
TradeSchema.index({
    traderAddress: 1,
    blockTime: -1
});
const Trade = models.Trade || model("Trade", TradeSchema);
}),
"[project]/db/models/Trader.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Trader",
    ()=>Trader
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
const TraderSchema = new Schema({
    address: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    label: {
        type: String,
        default: ""
    },
    notes: {
        type: String,
        default: ""
    },
    status: {
        type: String,
        enum: [
            "active",
            "blacklisted"
        ],
        default: "active",
        index: true
    },
    // null = inherit GlobalSettings.defaultMuted; true/false = explicit per-trader override.
    muted: {
        type: Boolean,
        default: null
    },
    addedAt: {
        type: Date,
        default: Date.now
    },
    blacklistedAt: {
        type: Date,
        default: null
    },
    stats: {
        tradeCount: {
            type: Number,
            default: 0
        },
        buyCount: {
            type: Number,
            default: 0
        },
        sellCount: {
            type: Number,
            default: 0
        },
        totalSolVolume: {
            type: Number,
            default: 0
        },
        realizedPnlSol: {
            type: Number,
            default: 0
        },
        wins: {
            type: Number,
            default: 0
        },
        losses: {
            type: Number,
            default: 0
        },
        lastTradeAt: {
            type: Date,
            default: null
        }
    }
});
const Trader = models.Trader || model("Trader", TraderSchema);
}),
"[project]/db/positionLedger.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getHoldings",
    ()=>getHoldings,
    "recordTrade",
    ()=>recordTrade
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trader.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trade$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trade.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PositionLot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/PositionLot.js [app-route] (ecmascript)");
;
;
;
const EPSILON = 1e-9;
async function recordTrade(trade) {
    const traderAddress = trade.wallet;
    try {
        await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trade$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trade"].create({
            traderAddress,
            signature: trade.signature,
            type: trade.type,
            program: trade.program,
            mint: trade.mint,
            tokenAmount: trade.tokenAmount,
            solAmount: trade.solAmount,
            solAmountSource: trade.solAmountSource,
            isNativeSolQuote: trade.isNativeSolQuote,
            quoteMint: trade.quoteMint,
            slot: trade.slot,
            blockTime: trade.blockTime
        });
    } catch (err) {
        if (err?.code === 11000) return false; // already recorded this exact leg
        throw err;
    }
    const lastTradeAt = trade.blockTime ? new Date(trade.blockTime * 1000) : new Date();
    if (trade.type === "buy") {
        if (trade.tokenAmount > 0) {
            await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PositionLot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PositionLot"].create({
                traderAddress,
                mint: trade.mint,
                tokenAmountRemaining: trade.tokenAmount,
                solCostRemaining: trade.solAmount || 0,
                openSignature: trade.signature
            });
        }
        await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].updateOne({
            address: traderAddress
        }, {
            $inc: {
                "stats.tradeCount": 1,
                "stats.buyCount": 1,
                "stats.totalSolVolume": trade.solAmount || 0
            },
            $set: {
                "stats.lastTradeAt": lastTradeAt
            }
        });
        return true;
    }
    // sell: consume FIFO lots for this mint
    const soldTokenAmount = trade.tokenAmount || 0;
    let remainingToMatch = soldTokenAmount;
    let costBasisMatched = 0;
    let matchedTokenAmount = 0;
    if (soldTokenAmount > EPSILON) {
        const lots = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PositionLot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PositionLot"].find({
            traderAddress,
            mint: trade.mint
        }).sort({
            openedAt: 1
        });
        for (const lot of lots){
            if (remainingToMatch <= EPSILON) break;
            const take = Math.min(lot.tokenAmountRemaining, remainingToMatch);
            const proportion = take / lot.tokenAmountRemaining;
            const costForTake = lot.solCostRemaining * proportion;
            costBasisMatched += costForTake;
            matchedTokenAmount += take;
            remainingToMatch -= take;
            const newRemaining = lot.tokenAmountRemaining - take;
            if (newRemaining <= EPSILON) {
                await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PositionLot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PositionLot"].deleteOne({
                    _id: lot._id
                });
            } else {
                await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PositionLot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PositionLot"].updateOne({
                    _id: lot._id
                }, {
                    $set: {
                        tokenAmountRemaining: newRemaining,
                        solCostRemaining: lot.solCostRemaining - costForTake
                    }
                });
            }
        }
    }
    const proceedsMatched = soldTokenAmount > EPSILON ? (trade.solAmount || 0) * (matchedTokenAmount / soldTokenAmount) : 0;
    const realizedPnl = matchedTokenAmount > EPSILON ? proceedsMatched - costBasisMatched : 0;
    const statsInc = {
        "stats.tradeCount": 1,
        "stats.sellCount": 1,
        "stats.totalSolVolume": trade.solAmount || 0,
        "stats.realizedPnlSol": realizedPnl
    };
    if (matchedTokenAmount > EPSILON) {
        if (realizedPnl > EPSILON) statsInc["stats.wins"] = 1;
        else if (realizedPnl < -EPSILON) statsInc["stats.losses"] = 1;
    }
    await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].updateOne({
        address: traderAddress
    }, {
        $inc: statsInc,
        $set: {
            "stats.lastTradeAt": lastTradeAt
        }
    });
    return true;
}
async function getHoldings(traderAddress) {
    const rows = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PositionLot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PositionLot"].aggregate([
        {
            $match: {
                traderAddress
            }
        },
        {
            $group: {
                _id: "$mint",
                tokenAmount: {
                    $sum: "$tokenAmountRemaining"
                },
                solCostBasis: {
                    $sum: "$solCostRemaining"
                }
            }
        }
    ]);
    return rows.filter((r)=>r.tokenAmount > EPSILON).map((r)=>({
            mint: r._id,
            tokenAmount: r.tokenAmount,
            solCostBasis: r.solCostBasis
        }));
}
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
const CACHE_TTL_MS = 15_000;
const cache = new Map(); // mint -> { data, expiresAt }
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
async function getCoinInfo(mint) {
    const cached = cache.get(mint);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const base = process.env.PUMP_FUN_API_BASE || "https://frontend-api-v3.pump.fun";
    const res = await fetch(`${base}/coins-v3/${mint}`);
    if (res.status === 404) {
        cache.set(mint, {
            data: null,
            expiresAt: Date.now() + CACHE_TTL_MS
        });
        return null;
    }
    if (!res.ok) throw new Error(`pump.fun API HTTP ${res.status} for ${mint}`);
    const data = await res.json();
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
"[project]/db/traderService.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addTrader",
    ()=>addTrader,
    "addTradersBulk",
    ()=>addTradersBulk,
    "setBlacklisted",
    ()=>setBlacklisted,
    "setMuted",
    ()=>setMuted,
    "setTraderMeta",
    ()=>setTraderMeta
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trader.js [app-route] (ecmascript)");
;
async function addTrader(address, { label = "" } = {}) {
    const existing = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address
    });
    if (existing) return {
        added: false,
        trader: existing
    };
    const trader = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].create({
        address,
        label
    });
    return {
        added: true,
        trader
    };
}
async function addTradersBulk(entries) {
    const normalized = entries.map((e)=>typeof e === "string" ? {
            address: e.trim(),
            label: ""
        } : {
            address: e.address?.trim(),
            label: e.label || ""
        }).filter((e)=>e.address);
    const seenInBatch = new Set();
    const deduped = [];
    for (const entry of normalized){
        if (seenInBatch.has(entry.address)) continue;
        seenInBatch.add(entry.address);
        deduped.push(entry);
    }
    const existingDocs = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].find({
        address: {
            $in: deduped.map((e)=>e.address)
        }
    }, {
        address: 1
    }).lean();
    const existingAddresses = new Set(existingDocs.map((d)=>d.address));
    const toInsert = deduped.filter((e)=>!existingAddresses.has(e.address));
    const skipped = deduped.filter((e)=>existingAddresses.has(e.address)).map((e)=>e.address);
    let added = [];
    if (toInsert.length > 0) {
        const docs = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].insertMany(toInsert.map((e)=>({
                address: e.address,
                label: e.label
            })), {
            ordered: false
        });
        added = docs.map((d)=>d.address);
    }
    return {
        added,
        skipped
    };
}
async function setBlacklisted(address, blacklisted) {
    return __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOneAndUpdate({
        address
    }, {
        status: blacklisted ? "blacklisted" : "active",
        blacklistedAt: blacklisted ? new Date() : null
    }, {
        returnDocument: "after"
    });
}
async function setMuted(address, muted) {
    // muted: true | false | null (null clears the override, falling back to the global default)
    return __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOneAndUpdate({
        address
    }, {
        muted
    }, {
        returnDocument: "after"
    });
}
async function setTraderMeta(address, { label, notes } = {}) {
    const update = {};
    if (label !== undefined) update.label = label;
    if (notes !== undefined) update.notes = notes;
    return __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOneAndUpdate({
        address
    }, update, {
        returnDocument: "after"
    });
}
}),
"[project]/lib/traderView.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "resolveTraderView",
    ()=>resolveTraderView,
    "resolveTraderViewWithHoldings",
    ()=>resolveTraderViewWithHoldings,
    "resolveTraderViews",
    ()=>resolveTraderViews
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/GlobalSettings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$positionLedger$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/positionLedger.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/pumpFunApi.js [app-route] (ecmascript)");
;
;
;
async function resolveTraderView(traderDoc, globalSettings) {
    const settings = globalSettings || await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getGlobalSettings"])();
    const plain = JSON.parse(JSON.stringify(traderDoc));
    return {
        ...plain,
        id: plain._id,
        mutedOverride: plain.muted,
        muted: plain.muted === null || plain.muted === undefined ? settings.defaultMuted : plain.muted
    };
}
async function resolveTraderViews(traderDocs) {
    const settings = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getGlobalSettings"])();
    return Promise.all(traderDocs.map((t)=>resolveTraderView(t, settings)));
}
async function resolveTraderViewWithHoldings(traderDoc) {
    const [view, holdings] = await Promise.all([
        resolveTraderView(traderDoc),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$positionLedger$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getHoldings"])(traderDoc.address)
    ]);
    const markedHoldings = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["markHoldings"])(holdings);
    const holdingsValueUsd = markedHoldings.reduce((sum, h)=>sum + (h.currentValueUsd || 0), 0);
    return {
        ...view,
        holdings: markedHoldings,
        holdingsValueUsd
    };
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1xnrho7._.js.map