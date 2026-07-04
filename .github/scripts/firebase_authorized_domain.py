#!/usr/bin/env python3
"""Firebase Authentication の認可ドメイン(authorizedDomains)を追加/削除する。

Cloud Run の PR プレビューは `pr-<番号>---<service>.run.app` という動的ホスト名で
配信されるため、そのままでは Firebase Auth の unauthorized-domain になる。
pr-preview ワークフローがデプロイ時に add / PR クローズ時に remove を呼び、
プレビュードメインの認可を自動で付け外しする（PR ごとの手作業を不要にする）。

使い方:
    firebase_authorized_domain.py <add|remove> <project_id> <domain>

認証は gcloud の access token を用いる（ワークフローでは WIF で得た deployer SA）。
deployer SA には roles/firebaseauth.admin が必要。
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in ("add", "remove"):
        print("usage: firebase_authorized_domain.py <add|remove> <project_id> <domain>", file=sys.stderr)
        return 2
    action, project, domain = sys.argv[1], sys.argv[2], sys.argv[3]

    token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()
    base = f"https://identitytoolkit.googleapis.com/admin/v2/projects/{project}/config"
    headers = {
        "Authorization": f"Bearer {token}",
        # ADC/SA のクォータプロジェクトを対象プロジェクトに固定する
        "X-Goog-User-Project": project,
        "Content-Type": "application/json",
    }

    cfg = json.load(urllib.request.urlopen(urllib.request.Request(base, headers=headers)))
    domains = list(cfg.get("authorizedDomains", []))

    if action == "add":
        if domain in domains:
            print(f"already authorized: {domain}")
            return 0
        domains.append(domain)
    else:  # remove
        if domain not in domains:
            print(f"not present, nothing to remove: {domain}")
            return 0
        domains = [d for d in domains if d != domain]

    body = json.dumps({"authorizedDomains": domains}).encode()
    req = urllib.request.Request(
        base + "?updateMask=authorizedDomains", data=body, headers=headers, method="PATCH"
    )
    try:
        urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        print(f"PATCH failed: {e.code} {e.read().decode()}", file=sys.stderr)
        return 1
    print(f"{action}: {domain} ok (authorizedDomains: {len(domains)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
