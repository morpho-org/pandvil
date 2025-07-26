import { type PortFinderOptions, getPortsPromise } from "portfinder";

export class PortAllocator {
  static readonly instance = new PortAllocator();

  private readonly reserved = new Set<number>();

  private constructor() {}

  async reserve(count: number, options: PortFinderOptions, expiryMs = 10_000): Promise<number[]> {
    try {
      const available: number[] = [];
      let minPort = options.port;

      while (available.length < count) {
        // Search for unbound (but possibly reserved) ports
        const unbound = await getPortsPromise(count - available.length, {
          ...options,
          port: minPort,
        });
        minPort = Math.max(...unbound) + 1;

        for (const port of unbound.filter((port) => !this.reserved.has(port))) {
          this.reserved.add(port);
          available.push(port);
        }
      }

      setTimeout(() => {
        this.expire(available);
      }, expiryMs);

      return available.concat();
    } catch {
      throw new Error(`Not enough ports available.`);
    }
  }

  expire(ports: number[]) {
    for (const port of ports) {
      this.reserved.delete(port);
    }
  }
}
