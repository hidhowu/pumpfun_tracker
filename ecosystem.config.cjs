module.exports = {
  apps: [
    {
      name: "pumpfun-tracker-web",
      cwd: __dirname,
      script: "npx",
      args: "next start -p 4001 -H 127.0.0.1",
      interpreter: "none",
      env: { PORT: "4001" },
    },
    {
      name: "pumpfun-tracker-daemon",
      cwd: __dirname,
      script: "src/tracker.js",
      interpreter: "node",
    },
  ],
};
