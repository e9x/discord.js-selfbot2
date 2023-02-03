import fetch from "node-fetch";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tar from "tar";

const parentFolder = new URL("../", import.meta.url);
const packageOutput = new URL("../package/", import.meta.url);

await rm(packageOutput, {
  recursive: true,
  force: true,
});

const api = "https://registry.npmjs.com/discord.js/";
const json = await (await fetch(api)).json();

const versions = Object.keys(json.versions).filter((version) =>
  /^\d+\.\d+\.\d+$/.test(version)
);
const latestStable = versions[versions.length - 1];
if (!latestStable) throw new TypeError("Unable to find latest stable");

const latest = json.versions[latestStable];

console.log(`Using discord.js v${latestStable}`);

const tarRes = await fetch(latest.dist.tarball);

await new Promise((resolve, reject) =>
  tarRes.body
    .pipe(
      tar.x({
        gzip: true,
        C: fileURLToPath(parentFolder),
      })
    )
    .on("end", resolve)
    .on("error", reject)
);

console.log(`Extracted ${latest.dist.tarball}`);

{
  const wsReadyPath = new URL(
    "src/client/websocket/handlers/READY.js",
    packageOutput
  );

  let wsReady = await readFile(wsReadyPath, "utf-8");

  // data.application doesn't exist on user packets
  wsReady = wsReady.replace(
    /data\.application/g,
    "(data.application || { id: data.user.id, flags: data.user.flags })"
  );

  await writeFile(wsReadyPath, wsReady);

  console.log("Patched READY.js");
}

{
  const wsManagerPath = new URL(
    "src/client/websocket/WebSocketManager.js",
    packageOutput
  );

  let wsManager = await readFile(wsManagerPath, "utf-8");

  // users can't shard
  // sending the initial request is sketchy... but this is ok for now
  wsManager = wsManager.replace(
    /throw error\.status === 401 \? invalidToken : error;/g,
    `if (error.status === 401) return ${JSON.stringify({
      url: "wss://gateway.discord.gg",
      shards: 1,
      session_start_limit: {
        total: 1,
        remaining: 1,
        reset_after: 0,
        max_concurrency: 1,
      },
    })}; else throw error;`
  );

  await writeFile(wsManagerPath, wsManager);

  console.log("Patched WebSocketManager.js");
}

{
  const packagePath = new URL("package.json", packageOutput);

  let pkg = JSON.parse(await readFile(packagePath, "utf-8"));

  // insert our package name
  pkg.name = "@e9x/discord.js-selfbot2";
  pkg.description = "discord.js patched to work with selfbots";
  pkg.homepage = "https://github.com/e9x/discord.js-selfbot";
  pkg.repository = {
    type: "git",
    url: "https://github.com/e9x/discord.js-selfbot.git",
  };
  pkg.bugs = {
    url: "https://github.com/e9x/discord.js-selfbot/issues",
  };
  // tests are ran before being published to NPM
  // we don't need to do anything
  delete pkg.scripts;

  await writeFile(packagePath, JSON.stringify(pkg, null, 2));

  console.log("Patched package.json");
}

{
  await copyFile(
    new URL("README.md", parentFolder),
    new URL("README.md", packageOutput)
  );

  console.log("Added README.md");
}

console.log("Ready to publish");
