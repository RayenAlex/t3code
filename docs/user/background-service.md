# Running T3 Code in the background

Run T3 Code as a background user service on Linux, macOS, or Windows so your host stays reachable without keeping a terminal open.

## Manage the service

Install the `t3` CLI first ([Command line](./install.md#command-line)), then run these commands on the host machine:

| Task                                    | Command                                                   |
| --------------------------------------- | --------------------------------------------------------- |
| Set up access from other devices        | `t3 up`                                                   |
| Check how other devices reach it        | `t3 status`                                               |
| Install and start (or repair)           | `t3 service install`                                      |
| Check status and log path               | `t3 service status`                                       |
| Update to a newer release               | `t3 update`                                               |
| Restart                                 | `t3 service restart`                                      |
| Stop and remove from startup            | `t3 service uninstall`                                    |
| Remove service, launcher, and downloads | `t3 uninstall` (keeps `~/.t3/userdata` and `service.env`) |

- Pairing codes are never written to logs; run `t3 pair` or `t3 up` on the host to connect a device.
- `t3 update` asks before restarting (pass `--yes` in scripts). Pin a version with `t3 update 0.0.42`, switch tracks with `--channel nightly`, or downgrade with `--allow-downgrade`.

## Local network access

New services bind to localhost only. Run `t3 up --lan` (sets `T3CODE_LAN=true` in `service.env`) to listen on LAN and Tailscale addresses for direct desktop/mobile connections, or `t3 up --no-lan` to disable it. Anyone on that network can reach the port (gated by pairing). `T3CODE_HOST` overrides `T3CODE_LAN`. Hosted `app.t3.codes` always uses T3 Connect.

## Configure the service environment

Add `KEY=VALUE` entries to `service.env` in your T3 home directory (`~/.t3/service.env` by default). Values are literal (quote spaces or `#`; no shell expansion) and survive installs and updates.

```dotenv
T3CODE_PORT=3773
T3CODE_HOST=127.0.0.1
```

- `PATH`, `T3CODE_HOME`, `T3_BOOT_SERVICE_UNIT`, and `T3_SERVICE_LAUNCHER_CONTEXT` cannot be overridden here.
- Run `t3 service restart` after editing (and `chmod 600 ~/.t3/service.env` if it holds secrets).

### Show GLM or GPT quota from a Magpie gateway

In T3 Code, open **Settings → Providers → Magpie quota** for the environment
that runs Claude Code or Codex. Enter the Magpie gateway origin (without `/v1`),
the quota provider (normally `zhipu`), and the account name if the Magpie card
has one. If Magpie requires authentication, enter its gateway key. Use HTTPS
for gateways on untrusted networks. The key stays in the T3 Server's secret
store and is not sent back to the client.

Save to apply the setting immediately. It covers Claude Code and Codex instances
already using that gateway; it does not change their routing or login. If a GLM
model is exposed under a different name, enter its exact ID as a model alias.
The card appears in the open right rail when that model is selected. Re-reading
shows Magpie's cached quota; it does not refresh the vendor's quota or identify
which account handled the last message.

To display GPT quota, turn on **Show GPT quota** and save. For a route through
Magpie's `cpa` provider, enter `cpa` as the **Magpie GPT provider ID**. Leave the
provider ID blank to use Magpie's built-in Codex subscription. If the selected
provider has multiple cards, enter its exact account login or alias as shown in
Magpie. T3 only reads the cached card on Magpie with the same gateway key; no
CLIProxyAPI management address or key is needed. It shows the balance or quota
windows that Magpie reports, not a percentage inferred from the balance or from
request counts. For models without GPT in their ID or name, enter the exact ID as
an alias. The GPT model must be selected on an instance using this gateway.

An existing `T3CODE_MAGPIE_GLM_QUOTA` server variable still works until you save
an in-app configuration. Turning off the in-app setting also suppresses that
fallback.

## Platform support

- **Linux**: Requires systemd user services with lingering enabled so T3 Code starts at boot and survives logout.
- **macOS**: Starts at login, stops at logout. Keep the Mac logged in and awake for unattended access. If agents can't read Desktop/Documents/Downloads, grant Full Disk Access to the `t3` path in `~/Library/LaunchAgents/com.t3tools.t3code.service.plist`.
- **Windows**: Runs windowless via Task Scheduler (`t3code-<domain>-<user>`) while signed in and auto-restarts on exit. Lock the screen instead of signing out for unattended access.

> Note: Signing out of T3 Connect does not stop or uninstall the background service.

## Keep the server responsive under memory pressure (Linux)

On Linux, agents run at lower priority than the server, but heavy memory use can still trigger the OOM killer. Run as your normal user:

```sh
t3 service protect
```

It previews system changes, asks for confirmation and `sudo`, and optionally protects Tailscale and SSH too. Run `t3 service restart` for OOM-killer protection to take effect, or `t3 service protect --undo` to remove it.

## Troubleshooting

Run `t3 service status` on the host to see the log path and health checks:

| Status                                 | Fix                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `linger-disabled`                      | Run `sudo loginctl enable-linger "$(id -un)"` (or `ssh -t your-server '...'`), then retry setup as your normal user. Never run T3 Code as root. |
| `linger-unavailable`                   | Check `loginctl show-user "$(id -un)" --property=Linger` and verify `systemd-logind`.                                                           |
| `user-manager-unavailable`             | Run `systemctl --user status` in a login session to verify systemd user support.                                                                |
| `service-disabled` / `service-stopped` | Check the log and `systemctl --user status t3code.service`, then run `t3 service install`.                                                      |
| `restart-pending`                      | Run `t3 service restart` to switch to the newly installed version.                                                                              |

For T3 Connect issues, see [T3 Connect troubleshooting](./t3-connect-troubleshooting.md).

## Reclaim database space

T3 Code automatically prunes old internal history while keeping conversations. Older databases that still hold freed space show a **Reclaim** button in **Settings → Maintenance** when at least 1 GiB is reclaimable (pauses the server/agents during repair).

For manually started servers (or CLI use), stop any hand-started server or desktop app and run:

```sh
t3 doctor          # Interactive repair (auto-stops/restarts a background service)
t3 doctor --dry-run
t3 doctor --fix    # Non-interactive recommended repairs
```

- Needs free disk space of ~2× active data size (in `TMPDIR`/`/var/tmp` and beside the database). Large databases can take over an hour.
- `t3 doctor` optionally offers to remove the legacy pre-0.1.0 `state.sqlite` backup only when all active projects and threads exist in the current database (`--fix` never deletes it automatically).
