/** PM2 ecosystem: start API and web (built static). Run `yarn build` first. CWD is project root. */
module.exports = {
  apps: [
    {
      name: "api",
      cwd: ".",
      script: "node",
      args: "apps/api/dist/index.js",
      env: { NODE_ENV: "production" },
    },
    {
      name: "web",
      cwd: ".",
      script: "npx",
      args: "serve apps/web/dist -l 5173",
      env: { NODE_ENV: "production" },
    },
  ],
};
