import { readFileSync } from "node:fs";

const marker = "<!-- debtlens-report -->";
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
const reportPath = process.argv[2];

if (!token || !repository || !eventPath || !reportPath) {
  process.exit(0);
}

const event = JSON.parse(readFileSync(eventPath, "utf8"));
if (event.pull_request?.number === undefined) {
  console.log("DebtLens: skipping PR comment (not a pull_request event).");
  process.exit(0);
}

const [owner, repo] = repository.split("/");
const issueNumber = event.pull_request.number;
const body = readFileSync(reportPath, "utf8");
const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

const listResponse = await fetch(
  `${apiBase}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
  { headers },
);
if (!listResponse.ok) {
  throw new Error(`Failed to list PR comments: ${listResponse.status}`);
}

const comments = await listResponse.json();
const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(marker));

if (existing) {
  const updateResponse = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!updateResponse.ok) {
    throw new Error(`Failed to update PR comment: ${updateResponse.status}`);
  }
  console.log("DebtLens: updated existing pull request comment.");
} else {
  const createResponse = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!createResponse.ok) {
    throw new Error(`Failed to create PR comment: ${createResponse.status}`);
  }
  console.log("DebtLens: created pull request comment.");
}
