import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE_NAME } from "../schema/config.js";
import { color, type Io, processIo } from "./report.js";
import { EXIT_OK } from "./shared.js";

export interface InitCommandOptions {
  cwd?: string;
  io?: Io;
}

const CONFIG_TEMPLATE = `version: "1"

features:
  directory: ./features

catalogs:
  services: ./services.yaml
  events: ./events.yaml

output:
  directory: ./generated

render:
  view: flow
  direction: TD
`;

const SERVICES_TEMPLATE = `version: "1"

services:

  accounts:
    name: Accounts Service
    operations:
      create-account:
        kind: http
        method: POST
        path: /accounts
`;

const EVENTS_TEMPLATE = `version: "1"

events:

  AccountCreated:
    topic: accounts.created
    producer: accounts
    description: A new account was created.
`;

const FEATURE_TEMPLATE = `version: "1"

feature:
  id: signup
  name: Signup
  description: Minimal example feature created by \`logicspec init\`.

start: signup-page

actors:

  visitor:
    kind: user
    label: Visitor

  web:
    kind: frontend
    label: Web App

  accounts:
    kind: service
    label: Accounts Service

context:

  email:
    type: string

  accountId:
    type: string

steps:

  signup-page:
    type: page
    label: Sign Up
    actor: web
    route: /signup
    actions:
      submit:
        label: Create account
        produces:
          - email
        next: create-account

  create-account:
    type: operation
    label: Create Account
    actor: accounts
    call: accounts.create-account
    requires:
      - email
    produces:
      - accountId
    on:
      success:
        next: account-created
      error:
        next: signup-error

  account-created:
    type: event
    label: Account Created
    actor: accounts
    direction: publish
    event: AccountCreated
    next: done

  signup-error:
    type: error
    label: Signup Failed
    message: Could not create the account.
    actions:
      retry:
        label: Try again
        next: signup-page

  done:
    type: final
    label: Account Created
    outcome: success
`;

/** `logicspec init` — scaffolds a workspace; never overwrites existing files. */
export function runInit(options: InitCommandOptions = {}): number {
  const io = options.io ?? processIo;
  const cwd = options.cwd ?? process.cwd();

  const files: Array<[string, string]> = [
    [CONFIG_FILE_NAME, CONFIG_TEMPLATE],
    ["services.yaml", SERVICES_TEMPLATE],
    ["events.yaml", EVENTS_TEMPLATE],
    [path.join("features", "signup.feature.yaml"), FEATURE_TEMPLATE],
    [path.join("generated", ".gitkeep"), ""],
  ];

  for (const [relative, content] of files) {
    const full = path.resolve(cwd, relative);
    if (fs.existsSync(full)) {
      io.out(`${color.dim("skip")}  ${relative} (already exists)`);
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    io.out(`${color.green("write")} ${relative}`);
  }

  io.out("");
  io.out("Workspace ready. Try:");
  io.out("  logicspec validate features/signup.feature.yaml");
  io.out("  logicspec render features/signup.feature.yaml");
  io.out("  logicspec watch");
  return EXIT_OK;
}
