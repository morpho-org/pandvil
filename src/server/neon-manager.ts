import { exec } from "child_process";
import os from "os";
import { promisify } from "util";

import { toArgs } from "@/server/children/spawn";

const execAsync = promisify(exec);

interface NeonBranch {
  name?: string;
  id: string;
  connectionString: string;
}

export class NeonManager {
  public readonly branches = new Map<string, NeonBranch>();

  constructor(private readonly projectId: string) {}

  async createBranch(args: { parent: string; name?: string }) {
    args.name ??= `${args.parent}-pandvil-${os.hostname().slice(0, 6)}-${Math.floor(Date.now() / 1000)}`;

    try {
      const command = [
        "neon branches create",
        ...toArgs({ projectId: this.projectId, output: "json", ...args }),
      ].join(" ");

      const output = await execAsync(command);
      const result = JSON.parse(output.stdout) as {
        branch: { name: string; id: string };
        connection_uris: { connection_uri: string }[];
      };

      const branch: NeonBranch = {
        name: result.branch.name,
        id: result.branch.id,
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
    return Promise.allSettled(
      [...this.branches.values()].map((branch) => this.deleteBranch(branch.id)),
    );
  }
}
