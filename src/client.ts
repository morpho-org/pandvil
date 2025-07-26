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
    const response = await fetch(`${this.baseUrl}/spawn`, {
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
    const response = await fetch(`${this.baseUrl}/instance/${id}`);
    const x = await response.json();

    if (!response.ok || !isInstanceStatusResponse(x)) {
      throw new Error(`Client.get error: (${response.status}) ${(x as { error: string }).error}`);
    }

    this.instances.set(x.id, x);
    return x;
  }

  async kill(id: string) {
    const response = await fetch(`${this.baseUrl}/instance/${id}`, {
      method: "DELETE",
    });
    const x = await response.json();

    if (!response.ok) {
      throw new Error(`Client.kill error: (${response.status}) ${(x as { error: string }).error}`);
    }

    this.instances.delete(id);
  }

  async waitForReadiness(id: string, timeoutMs = 30_000, intervalMs = 1_000) {
    if (!this.instances.has(id)) {
      throw new Error(`Client.waitForReadiness error: instance ${id} not yet spawned`);
    }

    try {
      await waitFor(() => this.get(id).then((x) => x.status === "ready"), {
        timeoutMs,
        intervalMs,
      });
    } catch {
      throw new Error(
        `Client.waitForReadiness error: instance ${id} not ready after ${timeoutMs / 1000} sec`,
      );
    }
  }
}
