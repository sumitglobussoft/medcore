module.exports = {
  apps: [
    {
      name: "medcore-api",
      script: "npx",
      args: "tsx apps/api/src/index.ts",
      cwd: "/home/empcloud-development/medcore",
      env: {
        PORT: 4100,
        NODE_ENV: "production",
        // DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, CORS_ORIGIN
        // should be set in .env file on the server
      },
    },
    {
      name: "medcore-web",
      script: "npx",
      args: "next start -p 3200",
      cwd: "/home/empcloud-development/medcore/apps/web",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
