import { PumpTradesClient } from "../backtest/pumpTradesClient.js";
import { LocalTradesClient, grpcTrackerConfigured } from "../grpc/client.js";

/**
 * The pump.fun HTTP clients of the "api" tracking method (Wallet.settings.trackingMethod). They are the same proxy-pooled, rate-paced
 * client the backtest uses (db/backtest/pumpTradesClient.js: round-robin over the proxy pool, a 429 cools only the proxy that got it,
 * never a direct connection while proxies exist), and read the same proxy list - so adding proxies on /proxies speeds this up too.
 *
 * Two instances so the pacing matches the endpoint: the user-trades endpoint (polled constantly) tolerates far more than the
 * token-trades one.
 */
export const userTradesClient = new PumpTradesClient({ rpsSetting: "userTradesRps" });
// Token trades (every pool price of the API Plus / gRPC way) come from the local gRPC tracking server when GRPC_TRACKER_URL is set
// (db/grpc/client.js: no proxies, no pump.fun API, one HTTP call on this machine); without it they still come from pump.fun's API.
export const tokenTradesClient = grpcTrackerConfigured() ? new LocalTradesClient() : new PumpTradesClient({ rpsSetting: "proxyRps" });
