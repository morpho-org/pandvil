#!/usr/bin/env node

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { Command } from "commander";
import dotenv from "dotenv";

import { Client } from "@/client";
import { toArgs } from "@/server/children/spawn";
import { Database } from "@/server/database";
import { NeonManager } from "@/server/neon-manager";
import { type ServerArgs, startServer } from "@/server/server";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packagePath = resolve(__dirname, "../..");

const packageJson = JSON.parse(
  readFileSync(join(packagePath, "package.json"), { encoding: "utf8" }),
) as {
  version: string;
};

const program = new Command();

program
  .name("pandvil")
  .description("CLI for interacting with Pandvil")
  .version(packageJson.version);

program
  .command("build")
  .description("Build a Docker image that composes the Pandvil dev server with your Ponder app")
  .argument("<name>", "The ponder app name")
  .option("--dockerfile <path>", "Path to Dockerfile relative to current directory", "Dockerfile")
  .option("--context <path>", "Path to Docker build context relative to Dockerfile", ".")
  .option("--args <path>", "Path to Docker build args (as JSON) relative to current directory")
  .option(
    "--ponder-app <path>",
    "Path to Ponder app (within container) relative to /workspace",
    ".",
  )
  .action((ponderAppName, options) => {
    const dockerfilePath = resolve(process.cwd(), options.dockerfile);
    if (!existsSync(dockerfilePath)) {
      console.error(`Error: Dockerfile not found at ${dockerfilePath}`);
      process.exit(1);
    }

    const contextPath = resolve(dirname(dockerfilePath), options.context);

    let buildArgs: object = {};
    if (options.args) {
      const argsPath = resolve(process.cwd(), options.args);
      if (!existsSync(argsPath)) {
        console.error(`Error: args JSON not found at ${argsPath}`);
        process.exit(1);
      }
      buildArgs = JSON.parse(readFileSync(argsPath, "utf-8")) as object;
    }

    // Construct docker buildx bake command
    const dockerCmdArgs = [
      "buildx",
      "bake",
      "-f",
      "docker-bake.hcl",
      "--allow",
      "fs.read=.",
      "--allow",
      `fs.read=${contextPath}`,
      "--load",
      "--set",
      `ponder-app.dockerfile=${dockerfilePath}`,
      "--set",
      `ponder-app.context=${contextPath}`,
    ];

    // Add build args
    for (const [key, value] of Object.entries(buildArgs)) {
      dockerCmdArgs.push("--set", `ponder-app.args.${key}=${value}`);
    }

    // Adds target group
    dockerCmdArgs.push("default");

    const dockerProcess = spawn("docker", dockerCmdArgs, {
      cwd: packagePath,
      stdio: "inherit",
      env: {
        ...process.env,
        PONDER_APP_NAME: ponderAppName,
        PONDER_APP_PATH: resolve("/workspace/ponder-app/", options.ponderApp),
      },
    });

    dockerProcess.on("error", (err) => {
      console.error("Failed to start Docker:", err);
      process.exit(1);
    });

    dockerProcess.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Docker build failed with exit code ${code}`);
        process.exit(code || 1);
      }
      console.log("Docker build completed successfully!");
    });
  });

const startCommand = program
  .command("start")
  .description("Run the Pandvil dev server")
  .optionsGroup("Server options:")
  .option("--port <port>", "Port to connect to Pandvil dev server", (v) => parseInt(v), 3999)
  .option(
    "--ponder-log-level <level>",
    "Minimum log level for Ponder (warn | error | info | debug | trace)",
    (v) => v as NonNullable<ServerArgs["ponderLogLevel"]>,
    "warn",
  )
  .option(
    "--anvil-interval-mining <interval>",
    "Block time (integer seconds) for anvil interval mining, or 'off'",
    (v) => parseInt(v) as number | "off",
    5,
  )
  .option("--parent-branch <id>", "Neon parent branch ID to fork off of", "main")
  .option(
    "--preserve-ephemeral-branch",
    "Whether to preserve the Neon child branch on server shutdown",
    false,
  )
  .option("--preserve-schemas", "Whether to preserve database schemas on instance shutdown", false)
  .option(
    "--spawn <schemas...>",
    "Number of instances to spawn, or variadic instance IDs",
    (value, prev) => {
      if (prev.length === 0) {
        if (Number.isInteger(parseInt(value))) {
          return [parseInt(value)] satisfies [number];
        } else {
          return [value] satisfies [string];
        }
      }

      if (typeof prev[0] === "number") {
        return prev;
      } else {
        return (prev as string[]).concat(value) as [string, ...string[]];
      }
    },
    [] as [] | [number] | [string, ...string[]],
  );

startCommand.command("local", { hidden: true }).action((_, command) => {
  const options = command.optsWithGlobals();
  // eslint-disable-next-line import-x/no-named-as-default-member
  dotenv.config({ path: [".env", ".env.local"] });

  startServer(options);
});

startCommand
  .command("docker", { isDefault: true })
  .argument("<name>", "The ponder app name")
  .optionsGroup("Additional options:")
  .option(
    "--prepare <N>",
    "Spawn N schemas and wait for backfill, preserving branch on exit for future use",
  )
  .action((ponderAppName, additionalOptions, command) => {
    const options = command.optsWithGlobals();
    // eslint-disable-next-line import-x/no-named-as-default-member
    dotenv.config({ path: [".env", ".env.local"] });

    const imageTag = `pandvil/${ponderAppName}:latest`;
    const port = options.port;

    console.log("\nStarting Pandvil container...");
    console.log(`❇︎ Image: ${imageTag}`);
    console.log(`❇︎ Port: ${port}`);
    console.log("");

    // Build docker command
    const dockerCmdArgs = ["run", "--rm", "-it", "-p", `${port}:3999`];

    // Add Neon environment variables
    if (process.env.NEON_API_KEY) {
      dockerCmdArgs.push("-e", `NEON_API_KEY=${process.env.NEON_API_KEY}`);
    }
    if (process.env.NEON_PROJECT_ID) {
      dockerCmdArgs.push("-e", `NEON_PROJECT_ID=${process.env.NEON_PROJECT_ID}`);
    }

    // Add all PONDER_RPC_URL_* environment variables
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("PONDER_RPC_URL_") && value) {
        dockerCmdArgs.push("-e", `${key}=${value}`);
      }
    }

    if (options.prepare) {
      options.preserveEphemeralBranch = true;
      options.preserveSchemas = true;
      options.anvilIntervalMining = "off";
      options.spawn = [options.prepare];
    }

    const serverOptions = { ...options };
    {
      for (const k in additionalOptions) {
        delete serverOptions[k as keyof typeof additionalOptions];
      }
    }

    // Add image and pass through remaining arguments to server
    dockerCmdArgs.push(
      imageTag,
      "start",
      "local",
      ...toArgs(serverOptions, { boolean: "omit-false", array: "repeat-flag" }),
    );

    const dockerProcess = spawn("docker", dockerCmdArgs, { stdio: "inherit" });

    dockerProcess.on("error", (err) => {
      console.error(`Container ${imageTag} failed to start:`, err);
      process.exit(1);
    });

    dockerProcess.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Container ${imageTag} exited with code ${code}`);
        process.exit(code ?? 1);
      }
      process.exit(0);
    });

    process.on("SIGINT", () => dockerProcess.kill("SIGINT"));
    process.on("SIGTERM", () => dockerProcess.kill("SIGTERM"));

    // Wait for backfill, then perform clean shutdown
    if (options.prepare) {
      const client = new Client(`http://localhost:${options.port}`);
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      const readinessCheckInterval = setInterval(async () => {
        let allReady = true;
        for (let i = 0; i < parseInt(options.prepare!); i += 1) {
          try {
            const resp = await client.get(`instance-${i}`);
            allReady &&= resp.status === "ready";
          } catch {
            allReady = false;
          }
        }

        if (allReady) {
          clearInterval(readinessCheckInterval);
          dockerProcess.kill("SIGINT");
        }
      }, 5_000);
    }
  });

program
  .command("trim")
  .description("Create a Neon branch with data trimmed to the specified block number(s)")
  .requiredOption("--parent-branch <name>", "The parent branch name")
  .requiredOption("--name <name>", "The new branch name")
  .requiredOption(
    "--block-numbers <chainId:blockNumber...>",
    "One or more chainId:blockNumber references to trim to",
  )
  .action(async (options) => {
    // eslint-disable-next-line import-x/no-named-as-default-member
    dotenv.config({ path: [".env", ".env.local"], override: true });

    const projectId = process.env.NEON_PROJECT_ID;
    if (!projectId) {
      throw new Error("Failed to start: missing NEON_PROJECT_ID");
    }

    const neonManager = new NeonManager(projectId);
    const branch = await neonManager.createBranch({
      parent: options.parentBranch,
      name: options.name,
    });
    const db = new Database(branch.connectionString);

    console.log(`\n🟩 Neon:\n ═╣ ${options.parentBranch}\n  ╙─☑︎ ${branch.name} (${branch.id})`);

    // Drop all user schemas, since they may have data we now consider "future"
    const schemas = await db.listSchemas();
    await db.dropSchemas(...schemas.filter((s) => !["ponder_sync", "public"].includes(s)));

    // Get latest block numbers
    const blockNumbers = await db.getLatestBlockNumbers();

    // Override latest block numbers from CLI if specified
    if (options.blockNumbers) {
      console.log("\n🔢 Latest block numbers:");
      console.log(blockNumbers);

      const overrides = new Map(
        options.blockNumbers.map((bn) => bn.split(":").map(Number) as [number, number]),
      );

      for (const entry of blockNumbers) {
        const override = overrides.get(entry.chainId);
        if (override !== undefined) {
          entry.blockNumber = override;
        }
      }

      console.log("\n🔢 Fork block numbers:");
      console.log(blockNumbers);
    }

    await db.updateBlockNumberIntervals(blockNumbers);
    await db.close();
  });

program.parse(process.argv);
