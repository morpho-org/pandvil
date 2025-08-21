import { waitFor } from "@/server/utils/wait-for";
import { type InstanceStatusResponse } from "@/types";

function isInstanceStatusResponse(x: unknown): x is InstanceStatusResponse {
  const y = x as object;
  return "id" in y && typeof y.id === "string";
}

export class Client {
  public readonly instances = new Map<string, Omit<InstanceStatusResponse, "status">>();

  constructor(private readonly baseUrl = "http://localhost:3999") {}

  async spawn(id?: string) {
    const response = await fetch(new URL("spawn", this.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
    const x = await response.json();

    if (!response.ok || !isInstanceStatusResponse(x)) {
      throw new Error(`Client.spawn error: (${response.status}) ${(x as { error: string }).error}`);
    }

    this.instances.set(x.id, x);
    return x;
  }

  async get(id: string) {
    const response = await fetch(new URL(`instance/${id}`, this.baseUrl));
    const x = await response.json();

    if (!response.ok || !isInstanceStatusResponse(x)) {
      throw new Error(`Client.get error: (${response.status}) ${(x as { error: string }).error}`);
    }

    this.instances.set(x.id, x);
    return x;
  }

  async kill(id: string) {
    const response = await fetch(new URL(`instance/${id}`, this.baseUrl), {
      method: "DELETE",
    });
    const x = await response.json();

    if (!response.ok) {
      throw new Error(`Client.kill error: (${response.status}) ${(x as { error: string }).error}`);
    }

    this.instances.delete(id);
  }

  // TODO: refactor to generalized "is status 200"
  async isServerReady() {
    try {
      const response = await fetch(new URL("ready", this.baseUrl));
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // TODO: probably don't need the following 2 `waitFor` wrappers
  async waitForServer(opts: Parameters<typeof waitFor>[1]) {
    try {
      await waitFor(() => this.isServerReady(), opts);
    } catch {
      throw new Error(
        `Client.waitForServer error: server not ready after ${opts.timeoutMs / 1000} sec`,
      );
    }
  }

  async waitForPonder(id: string, opts: Parameters<typeof waitFor>[1]) {
    if (!this.instances.has(id)) {
      throw new Error(`Client.waitForPonder error: instance ${id} not yet spawned`);
    }

    try {
      await waitFor(() => this.get(id).then((x) => x.status === "ready"), opts);
    } catch {
      throw new Error(
        `Client.waitForPonder error: instance ${id} not ready after ${opts.timeoutMs / 1000} sec`,
      );
    }
  }
}
