import { exec } from "child_process";
import os from "os";
import { promisify } from "util";

import { toArgs } from "@/server/children/spawn";

const execAsync = promisify(exec);

interface NeonBranch {
  name?: string;
  id: string;
  parentId?: string;
  connectionString: string;
}

export class NeonManager {
  public readonly branches = new Map<string, NeonBranch>();

  constructor(private readonly projectId: string) {}

  async createBranch(args: { parent: string; name?: string }) {
    args.name ??= `${args.parent}-pandvil-${os.hostname().slice(0, 6)}-${Math.floor(Date.now() / 1000)}`;

    try {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
      const command = [
        "neon branches create",
        ...toArgs({ projectId: this.projectId, output: "json", expiresAt, ...args }),
      ].join(" ");

      const output = await execAsync(command);
      const result = JSON.parse(output.stdout) as {
        branch: { name: string; id: string };
        connection_uris: { connection_uri: string }[];
      };

      const branch: NeonBranch = {
        name: result.branch.name,
        id: result.branch.id,
        parentId: args.parent,
        connectionString: result.connection_uris[0]!.connection_uri,
      };

      this.branches.set(branch.id, branch);
      return branch;
    } catch (e) {
      throw new Error(`Neon failed to create branch ${args.name}: ${e}`);
    }
  }

  async deleteBranch(branchId: string) {
    try {
      const command = [
        "neon branches delete",
        branchId,
        ...toArgs({ projectId: this.projectId, output: "json" }),
      ].join(" ");

      // TODO: currently errors silently -- would need to investigate Neon CLI
      // behavior to determine whether errors are in stdout or stderr
      await execAsync(command);

      this.branches.delete(branchId);
    } catch (e) {
      throw new Error(`Neon failed to delete branch ${branchId}: ${e}`);
    }
  }

  async deleteAll() {
    // Build a map of parent -> children
    const children = new Map<string, NeonBranch[]>();
    for (const branch of this.branches.values()) {
      if (branch.parentId === undefined) continue;
      const siblings = children.get(branch.parentId) ?? [];
      siblings.push(branch);
      children.set(branch.parentId, siblings);
    }

    // Delete branch and its descendants depth-first (children before parents)
    const deleteBranch = async (branch: NeonBranch): Promise<PromiseSettledResult<void>[]> => {
      const results: PromiseSettledResult<void>[] = [];
      for (const child of children.get(branch.id) ?? []) {
        results.push(...(await deleteBranch(child)));
      }
      try {
        await this.deleteBranch(branch.id);
        results.push({ status: "fulfilled", value: undefined });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
      return results;
    };

    // Start from root branches (those whose parents aren't managed by us)
    const results: PromiseSettledResult<void>[] = [];
    for (const branch of this.branches.values()) {
      if (branch.parentId === undefined || !this.branches.has(branch.parentId)) {
        results.push(...(await deleteBranch(branch)));
      }
    }
    return results;
  }
}
