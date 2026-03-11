const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3900;
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  try {
    const { app } = await createApp();
    app.listen(PORT, HOST, () => {
      console.log(`[nas-geek-console] running at http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('[nas-geek-console] startup failed:', err?.message || err);
    process.exit(1);
  }
}

main();
