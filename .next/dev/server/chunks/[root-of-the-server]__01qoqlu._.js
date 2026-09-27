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
"[project]/app/api/traders/[address]/settings/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "PATCH",
    ()=>PATCH
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/connect.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trader.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/traderService.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/settings.js [app-route] (ecmascript)");
;
;
;
;
;
const FIELDS = [
    "allocationUsd",
    "tradeSizeUsd",
    "dustBuyUsd",
    "dustSellFractionPercent",
    "stopLossPercent",
    "takeProfitPercent",
    "benchCapPercent",
    "allowNegativeBalance",
    "executionDelaySeconds",
    "feeUsd"
];
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
    const patch = {};
    for (const field of FIELDS){
        if (field in body) patch[field] = body[field];
    }
    const updated = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["setTraderSimSettings"])(address, patch);
    const effectiveSettings = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveTraderSettings"])(updated);
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        settings: updated.settings,
        effectiveSettings
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
"[project]/db/models/BalanceAdjustment.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BalanceAdjustment",
    ()=>BalanceAdjustment
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
/** Audit trail for manual balance top-ups (or deductions) from the dashboard. */ const BalanceAdjustmentSchema = new Schema({
    traderAddress: {
        type: String,
        required: true,
        index: true
    },
    amountUsd: {
        type: Number,
        required: true
    },
    reason: {
        type: String,
        default: ""
    },
    balanceAfterUsd: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});
const BalanceAdjustment = models.BalanceAdjustment || model("BalanceAdjustment", BalanceAdjustmentSchema);
}),
"[project]/db/models/DailySnapshot.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DailySnapshot",
    ()=>DailySnapshot
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
/**
 * One per (trader, UTC calendar day): the trader's total simulated
 * portfolio value (balance + unrealized value of open positions) at the
 * moment this snapshot was taken - used as the "start of day" baseline for
 * actualized P&L. See db/pnl.js.
 */ const DailySnapshotSchema = new Schema({
    traderAddress: {
        type: String,
        required: true,
        index: true
    },
    date: {
        type: String,
        required: true
    },
    portfolioValueUsdAtOpen: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});
DailySnapshotSchema.index({
    traderAddress: 1,
    date: 1
}, {
    unique: true
});
const DailySnapshot = models.DailySnapshot || model("DailySnapshot", DailySnapshotSchema);
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
    },
    // Simulation defaults - see db/settings.js for how per-trader overrides
    // resolve against these.
    defaultAllocationUsd: {
        type: Number,
        default: 100
    },
    defaultTradeSizeUsd: {
        type: Number,
        default: 20
    },
    defaultDustBuyUsd: {
        type: Number,
        default: 20
    },
    defaultDustSellFractionPercent: {
        type: Number,
        default: 10
    },
    defaultStopLossPercent: {
        type: Number,
        default: null
    },
    defaultTakeProfitPercent: {
        type: Number,
        default: null
    },
    defaultBenchCapPercent: {
        type: Number,
        default: null
    },
    defaultAllowNegativeBalance: {
        type: Boolean,
        default: true
    },
    defaultExecutionDelaySeconds: {
        type: Number,
        default: 2
    },
    defaultFeeUsd: {
        type: Number,
        default: 0.6
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
"[project]/db/models/PendingExecution.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "PendingExecution",
    ()=>PendingExecution
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
/**
 * A queued simulated buy/sell, waiting out the "execution delay" (default
 * 2s) that models real-world trade latency. Persisted (not an in-memory
 * setTimeout) so a daemon restart never loses a pending fill - a poller
 * just picks up anything with triggerAt <= now and status "pending".
 */ const PendingExecutionSchema = new Schema({
    traderAddress: {
        type: String,
        required: true,
        index: true
    },
    mint: {
        type: String,
        required: true
    },
    action: {
        type: String,
        enum: [
            "buy",
            "sell"
        ],
        required: true
    },
    triggerAt: {
        type: Date,
        required: true,
        index: true
    },
    sourceSignature: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: [
            "pending",
            "done",
            "skipped"
        ],
        default: "pending",
        index: true
    },
    skipReason: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    processedAt: {
        type: Date,
        default: null
    }
});
// DB-level backstop against ever queuing two pending buys (or two pending
// sells) for the same trader+mint at once - the application-level
// `.exists()` check in db/simulation/engine.js has a TOCTOU race window
// between two concurrent calls (e.g. two tracker processes momentarily
// running at once), so this partial unique index is what actually
// guarantees it can't happen: a second insert throws code 11000, which the
// caller treats as "already queued."
PendingExecutionSchema.index({
    traderAddress: 1,
    mint: 1,
    action: 1
}, {
    unique: true,
    partialFilterExpression: {
        status: "pending"
    }
});
const PendingExecution = models.PendingExecution || model("PendingExecution", PendingExecutionSchema);
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
"[project]/db/models/Trader.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Trader",
    ()=>Trader
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__ = __turbopack_context__.i("[externals]/mongoose [external] (mongoose, cjs, [project]/node_modules/mongoose)");
;
const { Schema, model, models } = __TURBOPACK__imported__module__$5b$externals$5d2f$mongoose__$5b$external$5d$__$28$mongoose$2c$__cjs$2c$__$5b$project$5d2f$node_modules$2f$mongoose$29$__["default"];
// Per-trader overrides for simulation behavior. null on any field means
// "inherit the matching default from GlobalSettings" - see db/settings.js.
const SimSettingsSchema = new Schema({
    allocationUsd: {
        type: Number,
        default: null
    },
    tradeSizeUsd: {
        type: Number,
        default: null
    },
    dustBuyUsd: {
        type: Number,
        default: null
    },
    dustSellFractionPercent: {
        type: Number,
        default: null
    },
    stopLossPercent: {
        type: Number,
        default: null
    },
    takeProfitPercent: {
        type: Number,
        default: null
    },
    benchCapPercent: {
        type: Number,
        default: null
    },
    allowNegativeBalance: {
        type: Boolean,
        default: null
    },
    executionDelaySeconds: {
        type: Number,
        default: null
    },
    feeUsd: {
        type: Number,
        default: null
    }
}, {
    _id: false
});
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
    // Stats about the REAL trader's own on-chain activity (not our simulation).
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
    },
    settings: {
        type: SimSettingsSchema,
        default: ()=>({})
    },
    // Our copy-trade simulation state for this trader.
    sim: {
        initialized: {
            type: Boolean,
            default: false
        },
        startingAllocationUsd: {
            type: Number,
            default: 0
        },
        balanceUsd: {
            type: Number,
            default: 0
        },
        everBoughtMints: {
            type: [
                String
            ],
            default: []
        },
        negativeBalanceEventCount: {
            type: Number,
            default: 0
        },
        maxNegativeBalanceUsd: {
            type: Number,
            default: 0
        },
        openPositionCount: {
            type: Number,
            default: 0
        },
        closedPositionCount: {
            type: Number,
            default: 0
        },
        realizedPnlUsd: {
            type: Number,
            default: 0
        },
        // When our sim wallet last actually acted (opened/closed a position) -
        // deliberately NOT the tracked wallet's own on-chain last-trade time,
        // since what matters here is our own simulated activity.
        lastActionAt: {
            type: Date,
            default: null
        }
    }
});
const Trader = models.Trader || model("Trader", TraderSchema);
}),
"[project]/db/settings.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "resolveTraderSettings",
    ()=>resolveTraderSettings,
    "settingsFieldNames",
    ()=>settingsFieldNames
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/GlobalSettings.js [app-route] (ecmascript)");
;
// [trader override field, global default field]
const FIELDS = [
    [
        "allocationUsd",
        "defaultAllocationUsd"
    ],
    [
        "tradeSizeUsd",
        "defaultTradeSizeUsd"
    ],
    [
        "dustBuyUsd",
        "defaultDustBuyUsd"
    ],
    [
        "dustSellFractionPercent",
        "defaultDustSellFractionPercent"
    ],
    [
        "stopLossPercent",
        "defaultStopLossPercent"
    ],
    [
        "takeProfitPercent",
        "defaultTakeProfitPercent"
    ],
    [
        "benchCapPercent",
        "defaultBenchCapPercent"
    ],
    [
        "allowNegativeBalance",
        "defaultAllowNegativeBalance"
    ],
    [
        "executionDelaySeconds",
        "defaultExecutionDelaySeconds"
    ],
    [
        "feeUsd",
        "defaultFeeUsd"
    ]
];
async function resolveTraderSettings(trader, globalSettings) {
    const g = globalSettings || await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getGlobalSettings"])();
    const resolved = {};
    for (const [overrideField, defaultField] of FIELDS){
        const override = trader.settings?.[overrideField];
        resolved[overrideField] = override === null || override === undefined ? g[defaultField] : override;
    }
    return resolved;
}
function settingsFieldNames() {
    return FIELDS.map(([overrideField])=>overrideField);
}
}),
"[project]/db/simulation/init.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ensureTraderInitialized",
    ()=>ensureTraderInitialized
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trader.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/settings.js [app-route] (ecmascript)");
;
;
async function ensureTraderInitialized(trader) {
    if (trader.sim?.initialized) return trader;
    const settings = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveTraderSettings"])(trader);
    const updated = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOneAndUpdate({
        address: trader.address,
        "sim.initialized": {
            $ne: true
        }
    }, {
        $set: {
            "sim.initialized": true,
            "sim.startingAllocationUsd": settings.allocationUsd,
            "sim.balanceUsd": settings.allocationUsd
        }
    }, {
        returnDocument: "after"
    });
    // If updated is null, another concurrent call already initialized it - re-fetch.
    return updated || __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address: trader.address
    });
}
}),
"[project]/db/traderService.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "addTrader",
    ()=>addTrader,
    "addTradersBulk",
    ()=>addTradersBulk,
    "adjustBalance",
    ()=>adjustBalance,
    "resetAllTradersSimulation",
    ()=>resetAllTradersSimulation,
    "resetTraderSimulation",
    ()=>resetTraderSimulation,
    "setBlacklisted",
    ()=>setBlacklisted,
    "setMuted",
    ()=>setMuted,
    "setTraderMeta",
    ()=>setTraderMeta,
    "setTraderSimSettings",
    ()=>setTraderSimSettings
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trader.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$BalanceAdjustment$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/BalanceAdjustment.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/SimPosition.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PendingExecution$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/PendingExecution.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/DailySnapshot.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$init$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/simulation/init.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/settings.js [app-route] (ecmascript)");
;
;
;
;
;
;
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
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$init$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ensureTraderInitialized"])(trader);
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
        for (const doc of docs)await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$init$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ensureTraderInitialized"])(doc);
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
async function setTraderSimSettings(address, patch) {
    const update = {};
    for (const [key, value] of Object.entries(patch)){
        if (value !== undefined) update[`settings.${key}`] = value;
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOneAndUpdate({
        address
    }, {
        $set: update
    }, {
        returnDocument: "after"
    });
}
async function adjustBalance(address, amountUsd, reason = "") {
    const trader = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address
    });
    if (!trader) throw new Error("Trader not found");
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$init$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ensureTraderInitialized"])(trader);
    const updated = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOneAndUpdate({
        address
    }, {
        $inc: {
            "sim.balanceUsd": amountUsd
        }
    }, {
        returnDocument: "after"
    });
    await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$BalanceAdjustment$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceAdjustment"].create({
        traderAddress: address,
        amountUsd,
        reason,
        balanceAfterUsd: updated.sim.balanceUsd
    });
    return updated;
}
async function resetTraderSimulation(address) {
    const trader = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address
    });
    if (!trader) throw new Error("Trader not found");
    const settings = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveTraderSettings"])(trader);
    await Promise.all([
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SimPosition"].deleteMany({
            traderAddress: address
        }),
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$PendingExecution$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["PendingExecution"].deleteMany({
            traderAddress: address
        }),
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DailySnapshot"].deleteMany({
            traderAddress: address
        }),
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$BalanceAdjustment$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["BalanceAdjustment"].deleteMany({
            traderAddress: address
        })
    ]);
    return __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOneAndUpdate({
        address
    }, {
        $set: {
            sim: {
                initialized: true,
                startingAllocationUsd: settings.allocationUsd,
                balanceUsd: settings.allocationUsd,
                everBoughtMints: [],
                negativeBalanceEventCount: 0,
                maxNegativeBalanceUsd: 0,
                openPositionCount: 0,
                closedPositionCount: 0,
                realizedPnlUsd: 0,
                lastActionAt: null
            }
        }
    }, {
        returnDocument: "after"
    });
}
async function resetAllTradersSimulation() {
    const traders = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].find({
        status: "active"
    }, {
        address: 1
    }).lean();
    for (const trader of traders){
        await resetTraderSimulation(trader.address);
    }
    return traders.map((t)=>t.address);
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__01qoqlu._.js.map