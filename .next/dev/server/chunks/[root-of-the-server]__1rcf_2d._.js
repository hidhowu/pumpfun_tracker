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
var __TURBOPACK__imported__module__$5b$project$5d2f$db$2f$simulation$2f$init$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/db/simulation/init.js [app-route] (ecmascript)");
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
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1rcf_2d._.js.map