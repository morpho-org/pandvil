#!/usr/bin/env node

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { Command } from "commander";
import dotenv from "dotenv";

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
  .description("CLI for interacting with Pandvil Docker containers")
  .version(packageJson.version)
  .enablePositionalOptions();

program
  .command("build")
  .description("Build a Docker image that composes the Pandvil dev server with your Ponder app")
  .requiredOption("--name <name>", "The ponder app name")
  .option("--dockerfile <path>", "Path to Dockerfile relative to current directory", "Dockerfile")
  .option("--context <path>", "Path to Docker build context relative to Dockerfile", ".")
  .option("--args <path>", "Path to Docker build args (as JSON) relative to current directory")
  .option(
    "--ponder-app <path>",
    "Path to Ponder app (within container) relative to /workspace",
    ".",
  )
  .action((options) => {
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
        PONDER_APP_NAME: options.name,
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

program
  .command("run")
  .description("Run the Pandvil dev server for your app")
  .requiredOption("--name <name>", "The ponder app name")
  .option("--port <port>", "Port to connect to Pandvil dev server", "3999")
  .allowExcessArguments()
  .allowUnknownOption()
  .action((options, command) => {
    // eslint-disable-next-line import-x/no-named-as-default-member
    dotenv.config({ path: [".env", ".env.local"], override: true });

    const imageTag = `pandvil/${options.name}:latest`;
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

    // Add image and pass through remaining arguments to server
    dockerCmdArgs.push(imageTag, ...command.args);

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
  });

program.parse(process.argv);
