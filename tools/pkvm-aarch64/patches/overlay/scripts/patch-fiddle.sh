#!/usr/bin/env bash
set -e

if [ -z "${BASE_DIR:-}" ]; then
  BASE_DIR=$(pwd)
fi

PATCHED_BRANCH="__pkvm_patched"
START_TAG="__pkvm_patched_start"

usage() {
  echo "$0 cmd"
  echo "cmd can be one of:"
  echo ""
  echo "  refresh <repo> <patchdir>"
  echo "  patch <repo> <patchdir>"
  echo "  force_patch <repo> <patchdir>"
  echo "  clean <repo>"
  echo "  prune <repo>"
  echo "  usage"
}

__do_patch()
{
  cd "$REPO_DIR"
  git tag -f "$START_TAG"
  git checkout --detach
  git branch -D "$PATCHED_BRANCH" || true
  git checkout -b "$PATCHED_BRANCH"
  echo "Patching $REPO_DIR..."
  git am "$PATCH_DIR"/[0-9][0-9][0-9][0-9]-*.patch
}

do_patch()
{
  cd "$REPO_DIR"
  curbranch=$(git rev-parse --abbrev-ref HEAD)
  if [ "x$curbranch" = "x$PATCHED_BRANCH" ]; then
    echo "The branch $PATCHED_BRANCH is the current branch in $REPO_DIR, not patching anything"
    exit 0
  fi
  force_patch
}

preclean()
{
  cd "$REPO_DIR"
  git reset --hard
  git clean -xfd
  cd ..
  git submodule update "$(basename "$REPO_DIR")"
}

force_patch()
{
  preclean
  __do_patch
}

clean()
{
  preclean
  cd "$REPO_DIR"
  echo "Trying to remove $START_TAG and $PATCHED_BRANCH from $REPO_DIR..."
  git tag -d "$START_TAG" || true
  git branch -D "$PATCHED_BRANCH" || true
}

prune()
{
  clean
  git -c gc.reflogExpireUnreachable=now gc --prune=now
}

refresh()
{
  rm -rf "$PATCH_DIR"/[0-9]*.patch
  cd "$REPO_DIR"
  echo "Refreshing patches..."
  git format-patch -o "$PATCH_DIR" "$PATCHED_BRANCH...$START_TAG"
}

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

opt=$1
case "$opt" in
  "refresh")
    [ $# -ge 3 ] || { usage; exit 1; }
    REPO_DIR="$BASE_DIR/$2"
    PATCH_DIR="$BASE_DIR/$3"
    refresh
    ;;
  "patch")
    [ $# -ge 3 ] || { usage; exit 1; }
    REPO_DIR="$BASE_DIR/$2"
    PATCH_DIR="$BASE_DIR/$3"
    do_patch
    ;;
  "force_patch")
    [ $# -ge 3 ] || { usage; exit 1; }
    REPO_DIR="$BASE_DIR/$2"
    PATCH_DIR="$BASE_DIR/$3"
    force_patch
    ;;
  "clean")
    [ $# -ge 2 ] || { usage; exit 1; }
    REPO_DIR="$BASE_DIR/$2"
    clean
    ;;
  "prune")
    [ $# -ge 2 ] || { usage; exit 1; }
    REPO_DIR="$BASE_DIR/$2"
    prune
    ;;
  *)
    usage
    ;;
esac
