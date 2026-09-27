module.exports = [
"[externals]/buffer [external] (buffer, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("buffer", () => require("buffer"));

module.exports = mod;
}),
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
"[project]/app/api/traders/[address]/reset/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/connect.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/traderService.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$traderView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/traderView.js [app-route] (ecmascript)");
;
;
;
;
async function POST(_request, { params }) {
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$connect$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["connectDb"])();
    const { address } = await params;
    try {
        const trader = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$traderService$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resetTraderSimulation"])(address);
        const view = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$traderView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveTraderDetailView"])(trader);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            trader: view
        });
    } catch (err) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: err instanceof Error ? err.message : "Failed to reset trader"
        }, {
            status: 400
        });
    }
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
    },
    // NOT a per-trader override (unlike the default* fields above) - this is
    // how often the daemon re-scans ALL open positions for stop-loss/take-
    // profit/bench triggers. One system-wide polling cadence, not something
    // that makes sense to vary per trader since it's a single sweep over
    // everyone's positions each tick. See src/tracker.js's risk-check loop.
    riskCheckIntervalSeconds: {
        type: Number,
        default: 20
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
            "processing",
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
"[project]/db/pnl.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "computeDailyBreakdown",
    ()=>computeDailyBreakdown,
    "computeDailyPnl",
    ()=>computeDailyPnl,
    "computeRangePnl",
    ()=>computeRangePnl,
    "computeStreaks",
    ()=>computeStreaks,
    "computeTodayQuickStats",
    ()=>computeTodayQuickStats
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/DailySnapshot.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/SimPosition.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/simulation/snapshot.js [app-route] (ecmascript)");
;
;
;
/**
 * Two distinct P&L metrics, computed per day (and rolled up to week/month):
 *
 * - "actualized": start-of-day portfolio value (balance + unrealized value
 *   of open positions) vs end-of-day portfolio value. This is what the
 *   trader's simulated wallet was actually worth, including positions
 *   still open.
 * - "combined": the arithmetic SUM of each individually-closed trade's %
 *   return within the period (e.g. +50% and +30% and -10% closed trades on
 *   the same day = "70% combined" for that day) - realized trades only,
 *   never includes anything still open. This is intentionally NOT a
 *   compounded/weighted return; it's a skill signal ("were their closed
 *   decisions net positive"), separate from actualized, which is exposed
 *   to whatever they're still holding.
 */ function addDaysUtc(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
function dayBoundsUtc(dateStr) {
    const start = new Date(`${dateStr}T00:00:00.000Z`);
    const end = new Date(`${addDaysUtc(dateStr, 1)}T00:00:00.000Z`);
    return {
        start,
        end
    };
}
async function combinedPnlForRange(traderAddress, start, end) {
    const closedPositions = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SimPosition"].find({
        traderAddress,
        status: "closed",
        closedAt: {
            $gte: start,
            $lt: end
        }
    }).lean();
    const combinedPercent = closedPositions.reduce((sum, p)=>sum + (p.realizedPnlPercent || 0), 0);
    const combinedUsd = closedPositions.reduce((sum, p)=>sum + (p.realizedPnlUsd || 0), 0);
    const wins = closedPositions.filter((p)=>(p.realizedPnlUsd || 0) > 0).length;
    const losses = closedPositions.filter((p)=>(p.realizedPnlUsd || 0) < 0).length;
    return {
        combinedUsd,
        combinedPercent,
        closedTradeCount: closedPositions.length,
        wins,
        losses
    };
}
async function computeDailyPnl(traderAddress, dateStr, { currentValue } = {}) {
    const nextDateStr = addDaysUtc(dateStr, 1);
    const isToday = dateStr === (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["todayUtcString"])();
    const [startSnap, endSnap] = await Promise.all([
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DailySnapshot"].findOne({
            traderAddress,
            date: dateStr
        }).lean(),
        __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DailySnapshot"].findOne({
            traderAddress,
            date: nextDateStr
        }).lean()
    ]);
    const startValue = startSnap?.portfolioValueUsdAtOpen ?? null;
    let endValue = endSnap?.portfolioValueUsdAtOpen ?? null;
    if (endValue === null && isToday) {
        endValue = currentValue !== undefined ? currentValue : await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["currentPortfolioValueUsd"])(traderAddress);
    }
    const actualizedUsd = startValue !== null && endValue !== null ? endValue - startValue : null;
    const actualizedPercent = startValue ? actualizedUsd / startValue * 100 : null;
    const { start, end } = dayBoundsUtc(dateStr);
    const combined = await combinedPnlForRange(traderAddress, start, end);
    return {
        date: dateStr,
        actualizedUsd,
        actualizedPercent,
        ...combined
    };
}
async function computeTodayQuickStats(traderAddress, { currentValue } = {}) {
    const today = (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["todayUtcString"])();
    const day = await computeDailyPnl(traderAddress, today, {
        currentValue
    });
    const decided = day.wins + day.losses;
    const winRatePercent = decided > 0 ? day.wins / decided * 100 : null;
    return {
        ...day,
        winRatePercent
    };
}
async function computeDailyBreakdown(traderAddress, days) {
    const today = (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["todayUtcString"])();
    const results = [];
    for(let i = days - 1; i >= 0; i--){
        const dateStr = addDaysUtc(today, -i);
        results.push(await computeDailyPnl(traderAddress, dateStr));
    }
    return results;
}
function classifyDay(day) {
    if (day.closedTradeCount === 0 || day.combinedPercent === 0) return "neutral";
    return day.combinedPercent > 0 ? "profit" : "loss";
}
function computeStreaks(dailyBreakdown) {
    let profitableDays = 0;
    let lossDays = 0;
    let longestProfitStreak = 0;
    let longestLossStreak = 0;
    let runType = null;
    let runLength = 0;
    for (const day of dailyBreakdown){
        const type = classifyDay(day);
        if (type === "profit") profitableDays += 1;
        if (type === "loss") lossDays += 1;
        if (type === runType) {
            runLength += 1;
        } else {
            runType = type;
            runLength = type === "neutral" ? 0 : 1;
        }
        if (runType === "profit") longestProfitStreak = Math.max(longestProfitStreak, runLength);
        if (runType === "loss") longestLossStreak = Math.max(longestLossStreak, runLength);
    }
    // Current streak: walk back from the most recent day.
    let currentStreakType = "none";
    let currentStreakLength = 0;
    for(let i = dailyBreakdown.length - 1; i >= 0; i--){
        const type = classifyDay(dailyBreakdown[i]);
        if (type === "neutral") break;
        if (currentStreakType === "none") currentStreakType = type;
        if (type !== currentStreakType) break;
        currentStreakLength += 1;
    }
    return {
        profitableDays,
        lossDays,
        neutralDays: dailyBreakdown.length - profitableDays - lossDays,
        longestProfitStreak,
        longestLossStreak,
        currentStreak: {
            type: currentStreakType,
            length: currentStreakLength
        }
    };
}
async function computeRangePnl(traderAddress, days) {
    const dailyBreakdown = await computeDailyBreakdown(traderAddress, days);
    const firstWithStart = dailyBreakdown.find((d)=>d.actualizedUsd !== null);
    const totalActualizedUsd = dailyBreakdown.reduce((sum, d)=>sum + (d.actualizedUsd || 0), 0);
    const totalCombinedUsd = dailyBreakdown.reduce((sum, d)=>sum + d.combinedUsd, 0);
    const totalCombinedPercent = dailyBreakdown.reduce((sum, d)=>sum + d.combinedPercent, 0);
    const totalClosedTrades = dailyBreakdown.reduce((sum, d)=>sum + d.closedTradeCount, 0);
    const totalWins = dailyBreakdown.reduce((sum, d)=>sum + (d.wins || 0), 0);
    const totalLosses = dailyBreakdown.reduce((sum, d)=>sum + (d.losses || 0), 0);
    return {
        days,
        actualizedUsd: firstWithStart ? totalActualizedUsd : null,
        combinedUsd: totalCombinedUsd,
        combinedPercent: totalCombinedPercent,
        closedTradeCount: totalClosedTrades,
        wins: totalWins,
        losses: totalLosses,
        winRatePercent: totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) * 100 : null,
        averageTradesPerDay: totalClosedTrades / days,
        dailyBreakdown,
        streaks: computeStreaks(dailyBreakdown)
    };
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
"[project]/db/simulation/snapshot.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "currentPortfolioValueUsd",
    ()=>currentPortfolioValueUsd,
    "ensureTodaySnapshot",
    ()=>ensureTodaySnapshot,
    "ensureTodaySnapshotsForAllActiveTraders",
    ()=>ensureTodaySnapshotsForAllActiveTraders,
    "todayUtcString",
    ()=>todayUtcString
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/Trader.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/SimPosition.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/DailySnapshot.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/pumpFunApi.js [app-route] (ecmascript)");
;
;
;
;
function todayUtcString(date = new Date()) {
    return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}
async function currentPortfolioValueUsd(traderAddress) {
    const trader = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].findOne({
        address: traderAddress
    });
    if (!trader) return 0;
    const openPositions = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$SimPosition$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SimPosition"].find({
        traderAddress,
        status: "open"
    });
    let unrealized = 0;
    for (const position of openPositions){
        const coin = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getCoinInfo"])(position.mint).catch(()=>null);
        const price = (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pumpFunApi$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["priceFromCoinInfo"])(coin);
        unrealized += price?.priceUsd ? position.tokenAmount * price.priceUsd : position.costBasisUsd; // fall back to cost basis if price is unavailable
    }
    return trader.sim.balanceUsd + unrealized;
}
async function ensureTodaySnapshot(traderAddress, date = todayUtcString()) {
    const existing = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DailySnapshot"].findOne({
        traderAddress,
        date
    });
    if (existing) return existing;
    const value = await currentPortfolioValueUsd(traderAddress);
    try {
        return await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DailySnapshot"].create({
            traderAddress,
            date,
            portfolioValueUsdAtOpen: value
        });
    } catch (err) {
        if (err?.code === 11000) return __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$DailySnapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DailySnapshot"].findOne({
            traderAddress,
            date
        }); // race - someone else just created it
        throw err;
    }
}
async function ensureTodaySnapshotsForAllActiveTraders() {
    const traders = await __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$Trader$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["Trader"].find({
        status: "active"
    }, {
        address: 1
    }).lean();
    for (const trader of traders){
        await ensureTodaySnapshot(trader.address);
    }
    return traders.length;
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
    "isValidSolanaAddress",
    ()=>isValidSolanaAddress,
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
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$bs58$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/bs58/index.js [app-route] (ecmascript)");
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
;
function isValidSolanaAddress(address) {
    if (typeof address !== "string" || address.length < 32 || address.length > 44) return false;
    try {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$bs58$2f$index$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["default"].decode(address).length === 32;
    } catch  {
        return false;
    }
}
async function addTrader(address, { label = "" } = {}) {
    if (!isValidSolanaAddress(address)) return {
        added: false,
        invalid: true
    };
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
    const invalid = normalized.filter((e)=>!isValidSolanaAddress(e.address)).map((e)=>e.address);
    const validEntries = normalized.filter((e)=>isValidSolanaAddress(e.address));
    const seenInBatch = new Set();
    const deduped = [];
    for (const entry of validEntries){
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
        skipped,
        invalid
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
"[project]/lib/traderView.js [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "resolveTraderDetailView",
    ()=>resolveTraderDetailView,
    "resolveTraderView",
    ()=>resolveTraderView,
    "resolveTraderViews",
    ()=>resolveTraderViews
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/models/GlobalSettings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$positionsView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/simulation/positionsView.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/settings.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pnl$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/pnl.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/simulation/snapshot.js [app-route] (ecmascript)");
;
;
;
;
;
async function resolveTraderView(traderDoc, globalSettings, { walletValueUsd } = {}) {
    const settings = globalSettings || await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getGlobalSettings"])();
    const plain = JSON.parse(JSON.stringify(traderDoc));
    await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ensureTodaySnapshot"])(plain.address);
    const value = walletValueUsd !== undefined ? walletValueUsd : await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$snapshot$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["currentPortfolioValueUsd"])(plain.address);
    const today = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$pnl$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["computeTodayQuickStats"])(plain.address, {
        currentValue: value
    });
    return {
        ...plain,
        id: plain._id,
        mutedOverride: plain.muted,
        muted: plain.muted === null || plain.muted === undefined ? settings.defaultMuted : plain.muted,
        walletValueUsd: value,
        today
    };
}
async function resolveTraderViews(traderDocs) {
    const settings = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$models$2f$GlobalSettings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getGlobalSettings"])();
    return Promise.all(traderDocs.map((t)=>resolveTraderView(t, settings)));
}
async function resolveTraderDetailView(traderDoc) {
    const [openPositions, effectiveSettings] = await Promise.all([
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$positionsView$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["getMarkedOpenPositions"])(traderDoc.address),
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$settings$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveTraderSettings"])(traderDoc)
    ]);
    const unrealizedPnlUsd = openPositions.reduce((sum, p)=>sum + (p.unrealizedPnlUsd || 0), 0);
    const openPositionsValueUsd = openPositions.reduce((sum, p)=>sum + (p.currentValueUsd || 0), 0);
    const walletValueUsd = traderDoc.sim.balanceUsd + openPositionsValueUsd;
    const view = await resolveTraderView(traderDoc, undefined, {
        walletValueUsd
    });
    return {
        ...view,
        openPositions,
        unrealizedPnlUsd,
        effectiveSettings
    };
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1yn7k2q._.js.map