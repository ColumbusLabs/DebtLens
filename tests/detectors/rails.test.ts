import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { defaultConfig } from "../../src/config/defaults.js";
import { getRulePack } from "../../src/config/packs.js";
import { scan } from "../../src/core/scan.js";
import { railsControllerSprawlDetector, railsRouteSprawlDetector } from "../../src/detectors/rails/index.js";
import { extractRailsControllerActions, extractRailsRoutes } from "../../src/detectors/rails/parse.js";
import { parseSourceFile } from "../../src/core/languages.js";
import { Project } from "ts-morph";
import { runDetector } from "../helpers/runDetector.js";

function railsScan(target: string, rules = getRulePack("rails").rules) {
  return scan({
    cwd: process.cwd(),
    target: resolve(target),
    include: ["**/*.rb"],
    exclude: defaultConfig.exclude,
    minSeverity: "info",
    rules,
    thresholds: defaultConfig.thresholds,
    maxFiles: defaultConfig.maxFiles,
    respectGitignore: defaultConfig.respectGitignore,
  });
}

function parseRubyFile(relativePath: string, content: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return parseSourceFile({
    project,
    absolutePath: `/${relativePath}`,
    relativePath,
    content,
    language: "ruby",
  });
}

describe("rails framework pack", () => {
  it("scans Rails fixtures and reports route and controller sprawl", async () => {
    const result = await railsScan("examples/rails");

    assert.ok(result.summary.filesScanned >= 2);
    assert.ok((result.summary.byRule["rails-route-sprawl"] ?? 0) >= 1);
    assert.ok((result.summary.byRule["rails-controller-sprawl"] ?? 0) >= 1);
    assert.ok(result.issues.some((issue) => issue.ruleId === "rails-route-sprawl"));
    assert.ok(result.issues.some((issue) => issue.ruleId === "rails-controller-sprawl"));
  });

  it("extracts Rails routes from routes.rb", () => {
    const file = parseRubyFile("config/routes.rb", `
Rails.application.routes.draw do
  get "/accounts", to: "accounts#index"
  post "/accounts", to: "accounts#create"
  resources :invoices
end
`);
    const routes = extractRailsRoutes(file);

    assert.ok(routes.length >= 9);
    assert.ok(routes.some((route) => route.method === "GET" && route.path === "/accounts"));
    assert.ok(routes.some((route) => route.source === "resources"));
  });

  it("counts constrained Rails resource routes written with common action list syntaxes", () => {
    const file = parseRubyFile("config/routes.rb", `
Rails.application.routes.draw do
  resources :accounts, only: %i[index show]
  resources :invoices, except: %i[destroy]
  resource :profile, only: ["show", "edit"]
  resources :teams, only: [:index, :show]
end
`);
    const routes = extractRailsRoutes(file);

    assert.equal(routes.filter((route) => route.path === "/accounts").length, 2);
    assert.equal(routes.filter((route) => route.path === "/invoices").length, 6);
    assert.equal(routes.filter((route) => route.path === "/profile").length, 2);
    assert.equal(routes.filter((route) => route.path === "/teams").length, 2);
  });

  it("extracts public controller actions and ignores private methods", () => {
    const file = parseRubyFile("app/controllers/accounts_controller.rb", `
class AccountsController < ApplicationController
  def index
  end

  def show
  end

  private

  def account_params
  end
end
`);
    const actions = extractRailsControllerActions(file);

    assert.deepEqual(actions.map((action) => action.name), ["index", "show"]);
  });

  it("flags route sprawl when routes exceed the threshold", async () => {
    const issues = await runDetector(railsRouteSprawlDetector, {
      "config/routes.rb": `
Rails.application.routes.draw do
  get "/a", to: "a#index"
  post "/a", to: "a#create"
  get "/b", to: "b#index"
  post "/b", to: "b#create"
  get "/c", to: "c#index"
  post "/c", to: "c#create"
  get "/d", to: "d#index"
  post "/d", to: "d#create"
  get "/e", to: "e#index"
end
`,
    }, {
      thresholds: { "rails-route-sprawl.maxRoutes": 8 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "rails-route-sprawl");
  });

  it("flags controller sprawl when public actions exceed the threshold", async () => {
    const issues = await runDetector(railsControllerSprawlDetector, {
      "app/controllers/reports_controller.rb": `
class ReportsController < ApplicationController
  def index; end
  def show; end
  def create; end
  def update; end
  def destroy; end
  def export; end
  def import; end
  def archive; end
  def restore; end
end
`,
    }, {
      thresholds: { "rails-controller-sprawl.maxActions": 8 },
    });

    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.ruleId, "rails-controller-sprawl");
    assert.match(issues[0]?.message ?? "", /9 public controller actions/);
  });

  it("ignores non-routes Ruby files for route sprawl", async () => {
    const issues = await runDetector(railsRouteSprawlDetector, {
      "app/models/account.rb": `
class Account < ApplicationRecord
  def full_name
    "#{first_name} #{last_name}"
  end
end
`,
    });

    assert.equal(issues.length, 0);
  });
});
