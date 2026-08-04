#!/usr/bin/env python3
"""
Inspect and act on a PR's review threads (CodeRabbit or human).

Why this exists: the REST endpoint `/repos/{o}/{r}/pulls/{n}/comments` does NOT
expose whether a thread is resolved. Only the GraphQL `reviewThreads` connection
has `isResolved`. Without that field you cannot tell "already handled" from
"still open", so `gh pr view` looking clean is not evidence that review is done.
Every command here goes through GraphQL for that reason.

Usage:
    review_threads.py list <pr>              # all threads + resolution state
    review_threads.py open <pr>              # unresolved only (exit 1 if any)
    review_threads.py show <pr> <thread-id>  # full body of one thread
    review_threads.py reply <pr> <thread-id> <<<'markdown body'
    review_threads.py resolve <thread-id>
    review_threads.py reply-resolve <pr> <thread-id> <<<'markdown body'

Repo defaults to the current directory's origin. Override with --repo owner/name.
Reply bodies are read from stdin so multi-line markdown survives intact.
"""

import argparse
import json
import subprocess
import sys

THREADS_QUERY = """
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first:1) {
            nodes { author { login } body }
          }
        }
      }
    }
  }
}
"""

REPLY_MUTATION = """
mutation($threadId:ID!, $body:String!) {
  addPullRequestReviewThreadReply(
    input:{pullRequestReviewThreadId:$threadId, body:$body}
  ) { comment { url } }
}
"""

RESOLVE_MUTATION = """
mutation($threadId:ID!) {
  resolveReviewThread(input:{threadId:$threadId}) {
    thread { isResolved }
  }
}
"""


def gh_graphql(query, **variables):
    cmd = ["gh", "api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        # -F coerces ints/bools; -f keeps strings (needed for multi-line bodies)
        flag = "-F" if isinstance(value, (int, bool)) else "-f"
        cmd += [flag, f"{key}={value}"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"gh api graphql failed:\n{result.stderr.strip()}")
    return json.loads(result.stdout)


def resolve_repo(explicit):
    if explicit:
        owner, _, name = explicit.partition("/")
        if not name:
            sys.exit(f"--repo must look like owner/name, got {explicit!r}")
        return owner, name
    result = subprocess.run(
        ["gh", "repo", "view", "--json", "owner,name"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        sys.exit("could not detect repo; pass --repo owner/name")
    data = json.loads(result.stdout)
    return data["owner"]["login"], data["name"]


def fetch_threads(owner, name, number):
    data = gh_graphql(THREADS_QUERY, owner=owner, name=name, number=int(number))
    return data["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]


def headline(thread):
    """First bold span of a CodeRabbit comment is its finding title.

    The title is sometimes followed by prose on the same line, so cut at the
    closing ** rather than taking the whole line.
    """
    comments = thread["comments"]["nodes"]
    if not comments:
        return "(no comments)"
    body = comments[0]["body"]
    for line in body.splitlines():
        if line.startswith("**"):
            rest = line[2:]
            end = rest.find("**")
            return (rest[:end] if end != -1 else rest).strip()
    return body.splitlines()[0][:100] if body.strip() else "(empty)"


def author(thread):
    comments = thread["comments"]["nodes"]
    if not comments or not comments[0].get("author"):
        return "unknown"
    return comments[0]["author"]["login"]


def print_threads(threads, only_open=False):
    shown = [t for t in threads if not t["isResolved"]] if only_open else threads
    resolved = sum(1 for t in threads if t["isResolved"])
    print(f"{len(threads)} threads — {resolved} resolved, {len(threads) - resolved} open\n")
    for thread in shown:
        state = "OPEN    " if not thread["isResolved"] else "resolved"
        outdated = " (outdated)" if thread["isOutdated"] else ""
        location = thread["path"] or "?"
        if thread["line"]:
            location += f":{thread['line']}"
        print(f"[{state}]{outdated} {location}")
        print(f"    {headline(thread)}")
        print(f"    by {author(thread)}  id={thread['id']}\n")
    return shown


def read_body():
    body = sys.stdin.read().strip()
    if not body:
        sys.exit("empty reply body on stdin — pipe markdown in, e.g. <<<'text'")
    return body


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command",
                        choices=["list", "open", "show", "reply", "resolve", "reply-resolve"])
    parser.add_argument("args", nargs="*")
    parser.add_argument("--repo", help="owner/name (defaults to current repo)")
    opts = parser.parse_args()

    if opts.command == "resolve":
        if len(opts.args) != 1:
            sys.exit("usage: review_threads.py resolve <thread-id>")
        gh_graphql(RESOLVE_MUTATION, threadId=opts.args[0])
        print(f"resolved {opts.args[0]}")
        return

    if not opts.args:
        sys.exit(f"usage: review_threads.py {opts.command} <pr> ...")

    owner, name = resolve_repo(opts.repo)
    number = opts.args[0]

    if opts.command in ("list", "open"):
        threads = fetch_threads(owner, name, number)
        shown = print_threads(threads, only_open=(opts.command == "open"))
        # Non-zero exit on remaining open threads makes this usable as a gate
        # in a loop: `until review_threads.py open 55; do ...; done`
        if opts.command == "open" and shown:
            sys.exit(1)
        return

    if opts.command == "show":
        if len(opts.args) != 2:
            sys.exit("usage: review_threads.py show <pr> <thread-id>")
        for thread in fetch_threads(owner, name, number):
            if thread["id"] == opts.args[1]:
                print(f"{thread['path']}:{thread['line']}  "
                      f"resolved={thread['isResolved']} outdated={thread['isOutdated']}\n")
                print(thread["comments"]["nodes"][0]["body"])
                return
        sys.exit(f"thread {opts.args[1]} not found on PR #{number}")

    if opts.command in ("reply", "reply-resolve"):
        if len(opts.args) != 2:
            sys.exit(f"usage: review_threads.py {opts.command} <pr> <thread-id> <<<'body'")
        thread_id = opts.args[1]
        body = read_body()
        gh_graphql(REPLY_MUTATION, threadId=thread_id, body=body)
        print(f"replied to {thread_id}")
        if opts.command == "reply-resolve":
            gh_graphql(RESOLVE_MUTATION, threadId=thread_id)
            print(f"resolved {thread_id}")


if __name__ == "__main__":
    main()
