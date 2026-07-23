#!/usr/bin/env bash
# Provision a Kata + Cloud Hypervisor host to the state G1 and S2 passed on.
#
# Specification: docs/product/repl-sandbox/REPL_SANDBOX_BUILD_PLAN.md section 4
# (Host provisioning gate G1) and section 5.2 (S2 - Boundary + persistence);
# the two upstream defaults this script exists to defeat are recorded in
# REPL_SANDBOX_LEARNINGS.md section 10a.
# Entrypoint: `npm run repl-sandbox:provision` (the non-test caller, AGENTS.md
# section 4 rule 15). Runs ON the Linux host, as root.
#
# Why this file exists. G1 and S2 were reached by hand, and three of the steps
# that got there are invisible to `kata-runtime check` - it passes without them:
#
#   1. `kata-static` bundles its own Cloud Hypervisor BELOW the ratified pin
#      (3.32.0 ships v51.1 against a pin of >= 52.0). Installing Kata alone
#      leaves the host one version short on the upstream that actually provides
#      the VM boundary.
#   2. Kata ships `configuration.toml` as a symlink to `configuration-qemu.toml`,
#      so a host that installs Cloud Hypervisor and stops there boots the
#      ratified pin's NEIGHBOUR while the operator believes otherwise.
#   3. containerd resolves the Kata shim by name on its own PATH; the shim lives
#      in /opt/kata/bin, which is not on it, so `ctr run --runtime
#      io.containerd.kata.v2` fails on a host where every G1 condition is green.
#
# A prose record of those three does not rebuild a host. This does.
#
# Idempotent: every step checks the desired state first and reports
# `already` rather than redoing it. `--verify` performs no mutation at all.
#
# What it does NOT do: no firewall, no CNI, no egress policy, no Tier-0 guest
# hardening. A guest booted on a host provisioned by this script has no network
# interfaces (a default of `ctr` without CNI, NOT an enforced control - see
# THREAT_MODEL requirement 6, which is unimplemented).

set -euo pipefail

# -- the pins. Two upstreams, two feeds, never one version checked twice. -----
KATA_VERSION="3.32.0"
KATA_SHA256="1449ecea50bd91fa73a94648db195d18950fe869ba4b1f12d05f55f1fa7c1b01"
CH_VERSION="v52.0"
CH_SHA256="829af01ff075bb96c4f183905134c453a88d68cbabdc6b87df21098842581ee9"
CH_REMOTE_SHA256="d4e8709ed3ef8ba5c66d98770342a2d7c3c96174cfa9c5ae9e3e55de999869a3"
# Pinned by digest, not by tag: `python:3.12-slim` is mutable and the recorded
# S2 run is only reproducible against this manifest.
GUEST_IMAGE="docker.io/library/python:3.12-slim"
GUEST_IMAGE_DIGEST="sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de"

KATA_URL="https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/kata-static-${KATA_VERSION}-amd64.tar.zst"
CH_URL="https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CH_VERSION}/cloud-hypervisor-static"
CH_REMOTE_URL="https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CH_VERSION}/ch-remote-static"

KATA_ROOT="/opt/kata"
KATA_CONF_DIR="${KATA_ROOT}/share/defaults/kata-containers"
WORK="/var/cache/trellis-kata"

VERIFY_ONLY=0
[ "${1:-}" = "--verify" ] && VERIFY_ONLY=1

fail=0
say()  { printf '  %-34s %s\n' "$1" "$2"; }
ok()   { say "$1" "OK: $2"; }
did()  { say "$1" "DONE: $2"; }
skip() { say "$1" "already: $2"; }
bad()  { say "$1" "FAIL: $2"; fail=$((fail + 1)); }

mutate() {
  # Refuse every mutation under --verify, so the verify path cannot drift from
  # a read-only claim by accident.
  if [ "$VERIFY_ONLY" = 1 ]; then
    say "$1" "WOULD CHANGE: $2"
    fail=$((fail + 1))
    return 1
  fi
  return 0
}

require_root() {
  [ "$(id -u)" = "0" ] || { echo "must run as root" >&2; exit 1; }
}

fetch_verified() {
  # $1 url, $2 destination, $3 expected sha256. Neither upstream publishes a
  # checksum manifest for these assets, so the digest is the one THIS repository
  # observed over HTTPS - a change means the asset moved, and that is a stop.
  local url="$1" dest="$2" want="$3" got
  if [ -f "$dest" ]; then
    got="$(sha256sum "$dest" | cut -d' ' -f1)"
    [ "$got" = "$want" ] && { echo "$dest"; return 0; }
    echo "cached $dest has digest $got, expected $want" >&2
    return 1
  fi
  mkdir -p "$(dirname "$dest")"
  curl -fsSL --retry 3 -o "$dest.part" "$url"
  got="$(sha256sum "$dest.part" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    rm -f "$dest.part"
    echo "downloaded $url has digest $got, expected $want - refusing" >&2
    return 1
  fi
  mv "$dest.part" "$dest"
  echo "$dest"
}

echo "== step 0: the host itself (this is G1's floor, not the whole gate) =="
require_root
if [ -c /dev/kvm ]; then ok "/dev/kvm" "present"; else bad "/dev/kvm" "absent - not a KVM host"; fi
if lsmod | grep -qE '^(kvm_amd|kvm_intel)'; then
  ok "kvm module" "$(lsmod | grep -oE '^(kvm_amd|kvm_intel)' | head -1)"
else
  bad "kvm module" "neither kvm_amd nor kvm_intel is loaded"
fi

echo "== step 1: containerd =="
if command -v containerd >/dev/null && command -v ctr >/dev/null; then
  skip "containerd" "$(containerd --version | awk '{print $3}')"
else
  if mutate "containerd" "apt-get install containerd"; then
    apt-get update -qq && apt-get install -y -qq containerd
    systemctl enable --now containerd
    did "containerd" "$(containerd --version | awk '{print $3}')"
  fi
fi

echo "== step 2: Kata ${KATA_VERSION} =="
if [ -x "${KATA_ROOT}/bin/kata-runtime" ] && \
   "${KATA_ROOT}/bin/kata-runtime" --version 2>/dev/null | grep -q "${KATA_VERSION}"; then
  skip "kata-static" "${KATA_VERSION} at ${KATA_ROOT}"
else
  if mutate "kata-static" "fetch + unpack ${KATA_VERSION}"; then
    tarball="$(fetch_verified "$KATA_URL" "${WORK}/kata-static-${KATA_VERSION}.tar.zst" "$KATA_SHA256")"
    # The tarball unpacks an ./opt/kata prefix.
    tar -xf "$tarball" -C /
    did "kata-static" "unpacked ${KATA_VERSION} to ${KATA_ROOT}"
  fi
fi

echo "== step 3: Cloud Hypervisor ${CH_VERSION} (defeats the bundled build) =="
bundled_version=""
if [ -x "${KATA_ROOT}/bin/cloud-hypervisor" ]; then
  bundled_version="$("${KATA_ROOT}/bin/cloud-hypervisor" --version 2>/dev/null | awk '{print $2}')"
fi
if [ "$bundled_version" = "$CH_VERSION" ]; then
  skip "cloud-hypervisor" "${CH_VERSION} in place"
else
  if mutate "cloud-hypervisor" "replace bundled ${bundled_version:-none} with ${CH_VERSION}"; then
    ch="$(fetch_verified "$CH_URL" "${WORK}/cloud-hypervisor-${CH_VERSION}" "$CH_SHA256")"
    chr="$(fetch_verified "$CH_REMOTE_URL" "${WORK}/ch-remote-${CH_VERSION}" "$CH_REMOTE_SHA256")"
    # Keep the bundled binary rather than deleting it: which build was displaced
    # is a fact a later incident wants.
    [ -n "$bundled_version" ] && \
      mv -n "${KATA_ROOT}/bin/cloud-hypervisor" "${KATA_ROOT}/bin/cloud-hypervisor-bundled-${bundled_version}"
    install -m 0755 "$ch" "${KATA_ROOT}/bin/cloud-hypervisor"
    install -m 0755 "$chr" "${KATA_ROOT}/bin/ch-remote"
    ln -sf "${KATA_ROOT}/bin/cloud-hypervisor" /usr/local/bin/cloud-hypervisor
    did "cloud-hypervisor" "${CH_VERSION} installed over bundled ${bundled_version:-none}"
  fi
fi
if [ -x "${KATA_ROOT}/bin/cloud-hypervisor" ]; then
  have="$("${KATA_ROOT}/bin/cloud-hypervisor" --version | awk '{print $2}')"
  [ "$have" = "$CH_VERSION" ] || bad "cloud-hypervisor pin" "${have} is not ${CH_VERSION}"
fi

echo "== step 4: the shim on containerd's PATH =="
if [ -x /usr/local/bin/containerd-shim-kata-v2 ]; then
  skip "shim" "/usr/local/bin/containerd-shim-kata-v2"
else
  if mutate "shim" "link the shim into /usr/local/bin"; then
    ln -sf "${KATA_ROOT}/bin/containerd-shim-kata-v2" /usr/local/bin/containerd-shim-kata-v2
    did "shim" "linked; ctr can now resolve io.containerd.kata.v2"
  fi
fi

echo "== step 5: configuration.toml points at the ratified VMM, not QEMU =="
current="$(readlink "${KATA_CONF_DIR}/configuration.toml" 2>/dev/null || echo none)"
if [ "$current" = "configuration-clh.toml" ]; then
  skip "kata config" "-> configuration-clh.toml"
else
  if mutate "kata config" "re-point ${current} -> configuration-clh.toml"; then
    ln -sfn configuration-clh.toml "${KATA_CONF_DIR}/configuration.toml"
    did "kata config" "was ${current}, now configuration-clh.toml"
  fi
fi

echo "== step 6: the guest image, pinned by digest =="
if ctr images ls -q 2>/dev/null | grep -qx "${GUEST_IMAGE}"; then
  have_digest="$(ctr images ls 2>/dev/null | awk -v r="${GUEST_IMAGE}" '$1==r{print $3}')"
  if [ "$have_digest" = "$GUEST_IMAGE_DIGEST" ]; then
    skip "guest image" "${GUEST_IMAGE_DIGEST}"
  else
    bad "guest image" "present at ${have_digest}, pinned to ${GUEST_IMAGE_DIGEST}"
  fi
else
  if mutate "guest image" "pull ${GUEST_IMAGE}@${GUEST_IMAGE_DIGEST}"; then
    ctr images pull "${GUEST_IMAGE}@${GUEST_IMAGE_DIGEST}" >/dev/null
    ctr images tag "${GUEST_IMAGE}@${GUEST_IMAGE_DIGEST}" "${GUEST_IMAGE}" >/dev/null
    did "guest image" "pulled at the pinned digest"
  fi
fi

echo "== step 7: Kata's own validator =="
if "${KATA_ROOT}/bin/kata-runtime" check >/dev/null 2>&1; then
  ok "kata-runtime check" "system can create Kata containers"
else
  bad "kata-runtime check" "$("${KATA_ROOT}/bin/kata-runtime" check 2>&1 | tail -1)"
fi

echo
if [ "$fail" -eq 0 ]; then
  cat <<'DONE'
Host provisioned. Neither this script nor `kata-runtime check` is the gate:

  cd src && python3 -m repl_sandbox.cli preflight     # G1  (acceleration differential)
  python3 scripts/repl_sandbox_s2_probe.py            # S2  (boundary + persistence)
  python3 scripts/repl_sandbox_s2_probe.py --negative-control   # must exit 3

DONE
  exit 0
fi
echo "${fail} condition(s) unmet." >&2
[ "$VERIFY_ONLY" = 1 ] && echo "(--verify mutates nothing; re-run without it to converge.)" >&2
exit 1
