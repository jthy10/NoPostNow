// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { tickDailyMoment } = await import("./server/daily");
  const timer = setInterval(() => {
    tickDailyMoment().catch(() => {});
  }, 20_000);
  timer.unref();
}
