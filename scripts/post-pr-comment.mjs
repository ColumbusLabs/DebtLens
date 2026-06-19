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
const failOnError = process.env.DEBTLENS_COMMENT_FAIL_ON_ERROR === "true";

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
};

try {
  const existing = await findExistingComment();
  if (existing) {
    await updateComment(existing.id);
    console.log("DebtLens: updated existing pull request comment.");
  } else {
    await createComment();
    console.log("DebtLens: created pull request comment.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (failOnError) {
    throw error;
  }
  console.warn(`DebtLens warning: ${message}. PR comment was not posted. Set comment-fail-on-error: true to make comment failures fail the Action.`);
}

async function findExistingComment() {
  for (let page = 1; ; page += 1) {
    const comments = await listComments(page);
    const existing = comments.find((comment) => typeof comment.body === "string" && comment.body.includes(marker));
    if (existing) return existing;
    if (comments.length < 100) return undefined;
  }
}

async function listComments(page) {
  const response = await fetch(
    `${apiBase}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`Failed to list PR comments: ${response.status}`);
  }
  const comments = await response.json();
  if (!Array.isArray(comments)) {
    throw new Error("Failed to list PR comments: response was not an array");
  }
  return comments;
}

async function updateComment(commentId) {
  const response = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update PR comment: ${response.status}`);
  }
}

async function createComment() {
  const response = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create PR comment: ${response.status}`);
  }
}
