#!/usr/bin/env node

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

import { Command } from "commander";

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
  .version(packageJson.version);

program
  .command("build")
  .description("Build a Docker image that composes the Pandvil dev server with your Ponder app")
  .option("--dockerfile <path>", "Path to Dockerfile relative to current directory", "Dockerfile")
  .option("--context <path>", "Path to Docker build context relative to Dockerfile", ".")
  .option("--args <path>", "Path to Docker build args (as JSON) relative to current directory")
  .option(
    "--ponder-app <path>",
    "Path to Ponder app (within container) relative to /workspace",
    ".",
  )
  .requiredOption("--name <name>", "The ponder app name")
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
  .command("start")
  .description("Start the Docker container")
  .option("--name <name>", "The ponder app name", "curator-api")
  .option("--port <port>", "Port to expose", "3999")
  .action((options) => {
    try {
      const runScript = join(packagePath, "scripts/run-docker.sh");

      // Execute the run script with environment variables
      const env = {
        ...process.env,
        PONDER_APP_NAME: options.name,
        PORT: options.port,
      };

      const runProcess = spawn("bash", [runScript], {
        stdio: "inherit",
        env,
      });

      runProcess.on("error", (err) => {
        console.error("Failed to start container:", err);
        process.exit(1);
      });

      runProcess.on("exit", (code) => {
        if (code !== 0) {
          console.error(`Container exited with code ${code}`);
          process.exit(code || 1);
        }
      });
    } catch (error) {
      console.error("Start failed:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);
