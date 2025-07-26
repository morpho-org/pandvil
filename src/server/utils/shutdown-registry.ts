export class ShutdownRegistry {
  static readonly instance = new ShutdownRegistry();

  private didStop = false;
  private fns: (() => Promise<void> | void)[] = [];

  private constructor() {
    const stop = this.stop.bind(this);

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.once("SIGINT", stop);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.once("SIGTERM", stop);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.once("uncaughtException", async (e) => {
      console.error("Uncaught exception:", e);
      await stop();
      process.exit(1);
    });
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    process.once("unhandledRejection", async (e) => {
      console.error("Unhandled rejection:", e);
      await stop();
      process.exit(1);
    });
  }

  async stop() {
    if (this.didStop) return;
    this.didStop = true;

    return Promise.allSettled(this.fns.map((fn) => fn()));
  }

  register(stop: (typeof this.fns)[number]) {
    this.fns.push(stop);
  }
}
